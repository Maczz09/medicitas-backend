const router = require('express').Router();
const controller = require('./pagos.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/pagos/procesar:
 *   post:
 *     summary: Procesar un pago de cita
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
 *               id_cita:
 *                 type: string
 *               monto:
 *                 type: number
 *               moneda:
 *                 type: string
 *               metodo_pago:
 *                 type: string
 *               token_tarjeta:
 *                 type: string
 *     responses:
 *       201:
 *         description: Pago procesado exitosamente
 */
router.post('/procesar', verifyToken, requireRole('Recepcionista'), controller.procesarPago);

module.exports = router;
