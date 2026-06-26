const { Router } = require('express');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');

const { PagosMySQLRepository }    = require('../adapters/out/repositories/PagosMySQLRepository');
const { CitaHttpAdapter }         = require('../adapters/out/http/CitaHttpAdapter');
const { CoberturaHttpAdapter }    = require('../adapters/out/http/CoberturaHttpAdapter');
const { OutboxMySQLPublisher }    = require('../adapters/out/events/OutboxMySQLPublisher');

const { ConfirmarPagoUseCase }         = require('../application/use-cases/ConfirmarPagoUseCase');
const { ReversarPagoUseCase }          = require('../application/use-cases/ReversarPagoUseCase');
const { ConsultarPagoUseCase }         = require('../application/use-cases/ConsultarPagoUseCase');
const { ConsultarPagoPorCitaUseCase }  = require('../application/use-cases/ConsultarPagoPorCitaUseCase');
const { PagosController }             = require('../adapters/in/PagosController');

const dbPool = require('../../../config/database');

const pool   = dbPool;
const connFn = async () => await dbPool.getConnection();
const repo   = new PagosMySQLRepository(pool);
const cita   = new CitaHttpAdapter();
const cob    = new CoberturaHttpAdapter();
const outbox = new OutboxMySQLPublisher(connFn);

const controller = new PagosController({
  confirmarUseCase: new ConfirmarPagoUseCase({
    pagosRepository: repo, citaValidator: cita,
    coberturaValidator: cob, eventPublisher: outbox, getConnection: connFn,
  }),
  reversarUseCase: new ReversarPagoUseCase({
    pagosRepository: repo, eventPublisher: outbox, getConnection: connFn,
  }),
  consultarUseCase:      new ConsultarPagoUseCase({ pagosRepository: repo }),
  consultarPorCitaUseCase: new ConsultarPagoPorCitaUseCase({ pagosRepository: repo }),
});

const router = Router();

// ── Listado de pagos (admin/auditoría) — paginado ─────────────────────────────
router.get('/', verifyToken, requireRole('RECEPCIONISTA', 'Auditor'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const estado = req.query.estado;
    const where = estado ? 'WHERE pg.estado = ?' : '';
    const params = estado ? [estado] : [];

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM svc_pag.pagos pg ${where}`, params);
    const [rows] = await pool.query(
      `SELECT pg.id_pago, pg.id_cita, pg.id_paciente, pg.codigo_autorizacion, pg.metodo_pago,
              pg.monto_total, pg.monto_cobertura, pg.monto_copago, pg.estado, pg.tipo_comprobante,
              pg.numero_comprobante, pg.created_at,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_pag.pagos pg
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = pg.id_paciente
       ${where}
       ORDER BY pg.created_at DESC
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
 * /api/v1/pagos:
 *   post:
 *     summary: Confirmar un pago físico (efectivo/POS)
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idCita:
 *                 type: string
 *               idPaciente:
 *                 type: string
 *               idValidacionCobertura:
 *                 type: string
 *               montoTotal:
 *                 type: number
 *               montoCubiertoSeguro:
 *                 type: number
 *               montoCopago:
 *                 type: number
 *               metodoPago:
 *                 type: string
 *                 enum: [EFECTIVO, POS]
 *               tipoComprobante:
 *                 type: string
 *                 enum: [BOLETA, FACTURA]
 *     responses:
 *       201:
 *         description: Pago confirmado exitosamente
 *       400:
 *         description: Datos inválidos o error de dominio
 */
router.post('/',              verifyToken, requireRole('RECEPCIONISTA', 'Auditor'),          controller.confirmar);

/**
 * @swagger
 * /api/v1/pagos/{id}:
 *   get:
 *     summary: Consultar detalle de un pago por su ID
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del pago (ej. PAG-12345)
 *     responses:
 *       200:
 *         description: Detalle del pago
 *       404:
 *         description: Pago no encontrado
 */
router.get('/:id',            verifyToken, requireRole(['RECEPCIONISTA','INTERNAL','Auditor']), controller.consultar);

/**
 * @swagger
 * /api/v1/pagos/cita/{idCita}:
 *   get:
 *     summary: Consultar el pago asociado a una cita
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idCita
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     responses:
 *       200:
 *         description: Detalle del pago
 *       404:
 *         description: Pago no encontrado
 */
router.get('/cita/:idCita',   verifyToken, requireRole(['RECEPCIONISTA','INTERNAL','Auditor']), controller.consultarPorCita);

/**
 * @swagger
 * /api/v1/pagos/{id}/reversar:
 *   post:
 *     summary: Reversar un pago confirmado
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del pago a reversar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motivo:
 *                 type: string
 *                 description: Razón de la reversión
 *     responses:
 *       200:
 *         description: Pago reversado exitosamente
 *       400:
 *         description: Error de dominio (ej. ya estaba reversado)
 *       404:
 *         description: Pago no encontrado
 */
router.post('/:id/reversar',  verifyToken, requireRole('RECEPCIONISTA', 'Auditor'),          controller.reversar);

module.exports = router;
