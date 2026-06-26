const { Router } = require('express');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');

// Instanciar dependencias (Dependency Injection manual)
const { ExpedienteMySQLRepository }  = require('../adapters/out/repositories/ExpedienteMySQLRepository');
const { EncuentroMySQLRepository }   = require('../adapters/out/repositories/EncuentroMySQLRepository');
const { CitaHttpAdapter }            = require('../adapters/out/http/CitaHttpAdapter');
const { PacienteHttpAdapter }        = require('../adapters/out/http/PacienteHttpAdapter');
const { OutboxMySQLPublisher }       = require('../adapters/out/events/OutboxMySQLPublisher');
const { ConsultarResumenClinicoUseCase }    = require('../application/use-cases/ConsultarResumenClinicoUseCase');
const { ConsultarHistoricoProfundoUseCase } = require('../application/use-cases/ConsultarHistoricoProfundoUseCase');
const { RegistrarConsultaUseCase }          = require('../application/use-cases/RegistrarConsultaUseCase');
const { HistoriaClinicaController }         = require('../adapters/in/HistoriaClinicaController');
const { Expediente }                        = require('../domain/entities/Expediente');
const { DomainError }                       = require('../../../shared/domain/errors');
const pool = require('../../../config/database');

const expRepo    = new ExpedienteMySQLRepository(pool);
const encRepo    = new EncuentroMySQLRepository(pool);
const citaAdp    = new CitaHttpAdapter();
const pacAdp     = new PacienteHttpAdapter();
const outbox     = new OutboxMySQLPublisher();
const connFn     = () => pool.getConnection();

const controller = new HistoriaClinicaController({
  resumenUseCase:   new ConsultarResumenClinicoUseCase({ expedienteRepository: expRepo, eventPublisher: outbox, getConnection: connFn }),
  historicoUseCase: new ConsultarHistoricoProfundoUseCase({ expedienteRepository: expRepo, encuentroRepository: encRepo, eventPublisher: outbox, getConnection: connFn }),
  registrarUseCase: new RegistrarConsultaUseCase({ expedienteRepository: expRepo, encuentroRepository: encRepo, citaValidator: citaAdp, eventPublisher: outbox, getConnection: connFn }),
});

const router = Router();

// Middleware base: Validar Token en todas las rutas
router.use(verifyToken);

/**
 * @swagger
 * /api/v1/historias-clinicas/expedientes:
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
 * /api/v1/historias-clinicas/{idPaciente}/resumen:
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
 * /api/v1/historias-clinicas/{idPaciente}/encuentros:
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
 * /api/v1/historias-clinicas/{idPaciente}/encuentros:
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
router.post('/:idPaciente/encuentros', requireRole('Médico', 'Auditor'), controller.registrarEncuentro);

module.exports = router;
