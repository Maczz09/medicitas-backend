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
router.post('/',              verifyToken, requireRole('RECEPCIONISTA'),          controller.confirmar);

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
router.get('/:id',            verifyToken, requireRole(['RECEPCIONISTA','INTERNAL']), controller.consultar);

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
router.get('/cita/:idCita',   verifyToken, requireRole(['RECEPCIONISTA','INTERNAL']), controller.consultarPorCita);

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
router.post('/:id/reversar',  verifyToken, requireRole('RECEPCIONISTA'),          controller.reversar);

module.exports = router;
