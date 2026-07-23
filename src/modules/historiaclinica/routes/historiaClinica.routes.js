const { Router } = require('express');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { validate } = require('../../../shared/infrastructure/validate.middleware');
const { registrarEncuentroSchema } = require('../../../shared/infrastructure/schemas');

// Instanciar dependencias (Dependency Injection manual)
const { ExpedienteMySQLRepository }  = require('../adapters/out/repositories/ExpedienteMySQLRepository');
const { EncuentroMySQLRepository }   = require('../adapters/out/repositories/EncuentroMySQLRepository');
const { CitaHttpAdapter }            = require('../adapters/out/http/CitaHttpAdapter');
const { OutboxMySQLPublisher }       = require('../adapters/out/events/OutboxMySQLPublisher');
const { ConsultarResumenClinicoUseCase }    = require('../application/use-cases/ConsultarResumenClinicoUseCase');
const { ConsultarHistoricoProfundoUseCase } = require('../application/use-cases/ConsultarHistoricoProfundoUseCase');
const { RegistrarConsultaUseCase }          = require('../application/use-cases/RegistrarConsultaUseCase');
const { HistoriaClinicaController }         = require('../adapters/in/HistoriaClinicaController');
const { Expediente }                        = require('../domain/entities/Expediente');
const { DomainError }                       = require('../../../shared/domain/errors');
const logger = require('../../../shared/logger/logger');
const pool = require('../../../config/database');

const expRepo    = new ExpedienteMySQLRepository(pool);
const encRepo    = new EncuentroMySQLRepository(pool);
const citaAdp    = new CitaHttpAdapter();
const outbox     = new OutboxMySQLPublisher();
const connFn     = () => pool.getConnection();

const controller = new HistoriaClinicaController({
  resumenUseCase:   new ConsultarResumenClinicoUseCase({ expedienteRepository: expRepo, eventPublisher: outbox, getConnection: connFn }),
  historicoUseCase: new ConsultarHistoricoProfundoUseCase({ expedienteRepository: expRepo, encuentroRepository: encRepo, eventPublisher: outbox, getConnection: connFn }),
  registrarUseCase: new RegistrarConsultaUseCase({ expedienteRepository: expRepo, encuentroRepository: encRepo, citaValidator: citaAdp, eventPublisher: outbox, getConnection: connFn }),
});

// ── Recovery Replay — reintenta completar citas cuyo encuentro clínico ya se
// guardó pero Citas estaba inalcanzable en el post-commit
// (cita_completada_verificada=0). Mismo patrón que pagos.routes.js/
// seguros.routes.js: se dispara al cerrar el CB de HistoriaClinica→Citas Y
// por sondeo periódico (un CB half-open solo se prueba si alguien hace una
// llamada nueva). Es seguro reintentar el MISMO comando (completarCita)
// porque Citas protege su propia máquina de estados (Cita.completar() exige
// En_Atencion): un reintento tardío nunca puede forzar una transición
// inválida, solo completar legítimamente o fallar limpio con 409 — en cuyo
// caso se alerta y se detiene el reintento, nunca se reinterpreta el estado
// a mano.
const RECOVERY_LIMIT_HCL = 20;
const REPLAY_HCL_INTERVAL_MS = parseInt(process.env.REPLAY_HCL_INTERVAL_MS || '15000');

let _replayHclEnCurso = false;
async function replayCitasPendientesCompletar() {
  if (_replayHclEnCurso) return;
  _replayHclEnCurso = true;
  try {
    const pendientes = await encRepo.findPendientesCompletarCita(RECOVERY_LIMIT_HCL);
    if (pendientes.length === 0) return;

    logger.info({ total: pendientes.length }, '[HCL] Recovery replay: reintentando completar citas pendientes');

    for (const p of pendientes) {
      try {
        await citaAdp.completarCita(p.idCita);
      } catch (err) {
        if (err.codigo === 'CITA_TRANSICION_INVALIDA') {
          // Citas ya rechazó esta transición — no reintentar más, alertar.
          const conn = await connFn();
          await conn.beginTransaction();
          try {
            await encRepo.marcarCitaCompletadaVerificada(p.idEncuentro, conn); // detiene el replay (affectedRows guard)
            await outbox.publish(conn, 'CitaCompletadaInconsistente', { idEncuentro: p.idEncuentro, idCita: p.idCita, motivo: err.message }, null);
            await conn.commit();
          } catch (e) {
            await conn.rollback();
            logger.error({ err: e, idEncuentro: p.idEncuentro }, '[HCL] fallo al registrar inconsistencia');
          } finally {
            conn.release();
          }
          continue;
        }
        logger.warn({ idEncuentro: p.idEncuentro, idCita: p.idCita, err: err.message }, '[HCL] Citas aún no disponible');
        if (citaAdp.breakerCompletar?.opened) break; // no seguir el lote si el CB reabrió
        continue;
      }

      const conn = await connFn();
      await conn.beginTransaction();
      try {
        const affectedRows = await encRepo.marcarCitaCompletadaVerificada(p.idEncuentro, conn);
        if (affectedRows > 0) {
          await outbox.publish(conn, 'CitaCompletadaReconciliada', { idEncuentro: p.idEncuentro, idCita: p.idCita }, null);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        logger.error({ err, idEncuentro: p.idEncuentro }, '[HCL] fallo al reconciliar');
      } finally {
        conn.release();
      }
    }
  } catch (err) {
    logger.error({ err }, '[HCL] Error en recovery replay de completar cita');
  } finally {
    _replayHclEnCurso = false;
  }
}

citaAdp.registrarRecuperacion(replayCitasPendientesCompletar);
const _replayHclTimer = setInterval(replayCitasPendientesCompletar, REPLAY_HCL_INTERVAL_MS);
_replayHclTimer.unref(); // No mantiene vivo el proceso en tests/shutdown

const router = Router();

// Middleware base: Validar Token en todas las rutas
router.use(verifyToken);

/**
 * @swagger
 * /api/v2/historias-clinicas/expedientes:
 *   post:
 *     summary: Crear (o recuperar) el expediente clínico de un paciente
 *     tags: [Historia Clínica]
 *     security:
 *       - bearerAuth: []
 */
router.post('/expedientes', requireRole('Médico', 'Recepcionista', 'Auditor'), async (req, res, next) => {
  try {
    const idPaciente = req.body.idPaciente || req.body.id_paciente;
    if (!idPaciente) {
      throw new DomainError('DATOS_INVALIDOS', 'idPaciente es obligatorio', 400);
    }
    // Idempotente: si ya existe expediente para el paciente, se devuelve.
    const existente = await expRepo.findByIdPaciente(idPaciente);
    if (existente) {
      return res.status(200).json({ data: { id: existente.id, idPaciente }, yaExistia: true });
    }
    const expediente = new Expediente({
      id: `HCL-${Date.now()}`,
      idPaciente,
      grupoSanguineo: req.body.grupoSanguineo || null,
      alergias: req.body.alergias || [],
    });
    const conn = await connFn();
    try {
      await expRepo.save(expediente, conn);
    } finally {
      conn.release();
    }
    return res.status(201).json({ data: { id: expediente.id, idPaciente } });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/v2/historias-clinicas/{idPaciente}/resumen:
 *   get:
 *     summary: Obtener resumen clínico del expediente
 *     tags: [Historia Clínica]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idPaciente
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resumen clínico obtenido
 */
router.get( '/:idPaciente/resumen', requireRole('Médico', 'Auditor'), controller.obtenerResumen);

/**
 * @swagger
 * /api/v2/historias-clinicas/{idPaciente}/encuentros:
 *   get:
 *     summary: Obtener el histórico profundo de encuentros clínicos (paginado)
 *     tags: [Historia Clínica]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idPaciente
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: pagina
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: porPagina
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Histórico de encuentros obtenido
 */
router.get( '/:idPaciente/encuentros', requireRole('Médico', 'Auditor'), controller.obtenerHistorico);

/**
 * @swagger
 * /api/v2/historias-clinicas/{idPaciente}/encuentros:
 *   post:
 *     summary: Registrar un nuevo encuentro clínico y prescripciones
 *     tags: [Historia Clínica]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idPaciente
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idCita:
 *                 type: string
 *               diagnosticoCie10:
 *                 type: string
 *               descripcion:
 *                 type: string
 *               prescripciones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     medicamento:
 *                       type: string
 *                     dosis:
 *                       type: string
 *                     indicaciones:
 *                       type: string
 *                     cantidad:
 *                       type: string
 *     responses:
 *       201:
 *         description: Encuentro clínico registrado con éxito
 */
router.post('/:idPaciente/encuentros', requireRole('Médico', 'Auditor'), validate(registrarEncuentroSchema), controller.registrarEncuentro);

router.patch('/:idPaciente/expediente', requireRole('Médico', 'Recepcionista', 'Auditor'), async (req, res, next) => {
  try {
    const { grupoSanguineo, alergias } = req.body;
    const existente = await expRepo.findByIdPaciente(req.params.idPaciente);
    if (!existente) {
      throw new DomainError('EXPEDIENTE_NO_ENCONTRADO', `Sin expediente para paciente ${req.params.idPaciente}`, 404);
    }
    await expRepo.update(req.params.idPaciente, { grupoSanguineo, alergias });
    res.json({ data: { idPaciente: req.params.idPaciente, grupoSanguineo, alergias } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
