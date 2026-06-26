const { Router } = require('express');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');

const { ComprobantesMySQLRepository } = require('../adapters/out/repositories/ComprobantesMySQLRepository');
const { ConsultarComprobanteUseCase } = require('../application/use-cases/ConsultarComprobanteUseCase');
const { FacturacionController }       = require('../adapters/in/FacturacionController');

const dbPool = require('../../../config/database');

const repo = new ComprobantesMySQLRepository(dbPool);
const consultarUseCase = new ConsultarComprobanteUseCase({ comprobantesRepository: repo });
const controller = new FacturacionController(consultarUseCase);

const router = Router();

/**
 * @swagger
 * /api/v1/facturacion/pago/{idPago}/comprobante:
 *   get:
 *     summary: Consultar comprobante asociado a un pago
 *     tags: [Facturacion]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idPago
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detalle del comprobante
 *       404:
 *         description: Comprobante no encontrado
 */
router.get('/pago/:idPago/comprobante', verifyToken, requireRole(['RECEPCIONISTA','INTERNAL','Auditor']), controller.consultarPorPago);

/**
 * @swagger
 * /api/v1/facturacion/comprobantes/{id}:
 *   get:
 *     summary: Consultar comprobante por su ID
 *     tags: [Facturacion]
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
 *         description: Detalle del comprobante
 *       404:
 *         description: Comprobante no encontrado
 */
router.get('/comprobantes/:id', verifyToken, requireRole(['RECEPCIONISTA','INTERNAL','Auditor']), controller.consultarPorId);

/**
 * @swagger
 * /api/v1/facturacion/comprobantes/{id}/pdf:
 *   get:
 *     summary: Descargar PDF del comprobante
 *     tags: [Facturacion]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Archivo PDF
 *       404:
 *         description: Comprobante o PDF no encontrado
 */
router.get('/comprobantes/:id/pdf', controller.descargarPdf);

module.exports = router;
