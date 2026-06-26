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
