const express = require('express');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { checkIdempotency } = require('../../../shared/infrastructure/api_idempotency.middleware');

const DespachosMySQLRepository = require('../adapters/out/DespachosMySQLRepository');
const OutboxEventPublisher = require('../adapters/out/OutboxEventPublisher');
const ConsultarEstadoRecetaUseCase = require('../application/use-cases/ConsultarEstadoRecetaUseCase');
const ReintentarEnvioUseCase = require('../application/use-cases/ReintentarEnvioUseCase');
const MarcarRetiradaUseCase = require('../application/use-cases/MarcarRetiradaUseCase');
const IniciarDespachoUseCase = require('../application/use-cases/IniciarDespachoUseCase'); // Requerido por ReintentarEnvioUseCase
const FarmaciaMockAdapter = require('../adapters/out/gateway/FarmaciaMockAdapter');
const FarmaciaAxiosAdapter = require('../adapters/out/gateway/FarmaciaAxiosAdapter');
const PrescripcionesController = require('../adapters/in/PrescripcionesController');

const dbPool = require('../../../config/database');

const gateway = process.env.USE_MOCK_FARMACIA === 'true'
  ? new FarmaciaMockAdapter()
  : new FarmaciaAxiosAdapter();

const repo = new DespachosMySQLRepository();
const eventPublisher = new OutboxEventPublisher();

// IniciarDespachoUseCase solo se usa para el helper en ReintentarEnvioUseCase
const iniciarDespachoUseCase = new IniciarDespachoUseCase({
  despachosRepository: repo,
  farmaciaGateway: gateway,
  eventPublisher: eventPublisher,
  getConnection: async () => await dbPool.getConnection(),
  logger: require('../../../shared/logger/logger')
});

const consultarEstadoRecetaUseCase = new ConsultarEstadoRecetaUseCase({
  despachosRepository: repo,
  getConnection: async () => await dbPool.getConnection()
});

const reintentarEnvioUseCase = new ReintentarEnvioUseCase({
  despachosRepository: repo,
  iniciarDespachoUseCase: iniciarDespachoUseCase,
  getConnection: async () => await dbPool.getConnection(),
  logger: require('../../../shared/logger/logger')
});

const marcarRetiradaUseCase = new MarcarRetiradaUseCase({
  despachosRepository: repo,
  eventPublisher: eventPublisher,
  getConnection: async () => await dbPool.getConnection(),
  logger: require('../../../shared/logger/logger')
});

const controller = new PrescripcionesController({
  consultarEstadoRecetaUseCase,
  reintentarEnvioUseCase,
  marcarRetiradaUseCase
});

// ── Recovery Replay: cola de despachos pendientes hacia farmacia ──────────────
// Cuando farmacia-api está caída, los despachos quedan en estado CREADA (la
// transacción de envío se revierte). Este replay los reenvía automáticamente:
//   1. Al cerrarse el Circuit Breaker (farmacia volvió a responder).
//   2. Por sondeo periódico — necesario porque un CB half-open solo se cierra
//      si alguien dispara una llamada; sin recetas nuevas, nadie lo haría.
const Despacho = require('../domain/entities/Despacho');
const logger = require('../../../shared/logger/logger');
const RECOVERY_LIMIT_FARMACIA = parseInt(process.env.RECOVERY_LIMIT_FARMACIA || '50');
const REPLAY_FARMACIA_INTERVAL_MS = parseInt(process.env.REPLAY_FARMACIA_INTERVAL_MS || '60000');

let _replayEnCurso = false;
async function replayDespachosPendientes() {
  if (_replayEnCurso) return;
  _replayEnCurso = true;
  try {
    const pendientes = await repo.findByEstado(Despacho.ESTADOS.CREADA, RECOVERY_LIMIT_FARMACIA, dbPool);
    if (pendientes.length === 0) return;

    logger.info({ total: pendientes.length }, '[Prescripciones] Recovery replay: reenviando despachos CREADA a farmacia');

    for (const d of pendientes) {
      // Sin idEventoOrigen el use case no puede reconocer el despacho existente
      // y crearía uno nuevo vacío — se omite (caso anómalo, revisar manualmente).
      if (!d.idEventoOrigen) {
        logger.warn({ id: d.id }, '[Prescripciones] Replay: despacho CREADA sin idEventoOrigen — omitido');
        continue;
      }
      try {
        // ejecutar() detecta el despacho existente por idEventoOrigen y, al
        // estar CREADA, reintenta el envío con el contenido persistido.
        await iniciarDespachoUseCase.ejecutar({}, d.correlationId, d.idEventoOrigen);
      } catch (err) {
        // Falla de transporte individual: el despacho sigue CREADA y se
        // reintentará en el próximo ciclo — no interrumpe el resto del lote.
        logger.warn({ id: d.id, err: err.message }, '[Prescripciones] Replay: despacho aún no entregable');
        // Si el CB volvió a abrirse no tiene sentido seguir con el lote.
        if (gateway.breaker?.opened) break;
      }
    }
  } catch (err) {
    logger.error({ err }, '[Prescripciones] Error en recovery replay de despachos');
  } finally {
    _replayEnCurso = false;
  }
}

gateway.registrarRecuperacion(replayDespachosPendientes);
const _replayTimer = setInterval(replayDespachosPendientes, REPLAY_FARMACIA_INTERVAL_MS);
_replayTimer.unref(); // No mantiene vivo el proceso en tests/shutdown

const router = express.Router();

// ── Listado de despachos de receta (admin/auditoría) — paginado ────────────────
router.get('/', verifyToken, requireRole('Médico', 'Recepcionista', 'Auditor'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const estado = req.query.estado;
    const where = estado ? 'WHERE d.estado = ?' : '';
    const params = estado ? [estado] : [];

    const [countRows] = await dbPool.query(`SELECT COUNT(*) AS total FROM svc_pre.despachos d ${where}`, params);
    const [rows] = await dbPool.query(
      `SELECT d.id, d.id_paciente, d.estado, d.contenido, d.referencia_farmacia, d.motivo_rechazo,
              d.intentos_envio, d.correlation_id, d.fecha_emision, d.created_at,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_pre.despachos d
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = d.id_paciente
       ${where}
       ORDER BY d.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total: countRows[0].total, page, limit, totalPages: Math.ceil(countRows[0].total / limit) },
      correlationId: req.correlationId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * tags:
 *   name: Prescripciones
 *   description: Gestión de despachos de recetas en farmacias
 */

/**
 * @swagger
 * /api/v1/recetas/{id}:
 *   get:
 *     summary: Consultar el estado de una receta enviada a la farmacia
 *     tags: [Prescripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la receta (ej. REC-XXXX)
 *     responses:
 *       200:
 *         description: Estado de la receta
 *       404:
 *         description: Receta no encontrada
 */
router.get('/:id',
  verifyToken,
  requireRole(['Médico', 'Recepcionista', 'Auditor']),
  controller.getReceta.bind(controller)
);

/**
 * @swagger
 * /api/v1/recetas/{id}/reintentar:
 *   post:
 *     summary: Reintentar el envío de una receta rechazada
 *     tags: [Prescripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reintento iniciado
 *       409:
 *         description: La receta no está en estado RECHAZADA
 */
router.post('/:id/reintentar',
  verifyToken,
  requireRole(['Médico', 'Recepcionista', 'Auditor']),
  checkIdempotency,
  controller.reintentarEnvio.bind(controller)
);

/**
 * @swagger
 * /api/v1/recetas/{id}/retirada:
 *   patch:
 *     summary: Registrar que el paciente retiró el medicamento
 *     tags: [Prescripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Retirada registrada
 *       409:
 *         description: La receta no está DESPACHADA
 */
router.patch('/:id/retirada',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor']),
  checkIdempotency,
  controller.marcarRetirada.bind(controller)
);

module.exports = router;
