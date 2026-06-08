const router = require('express').Router();
const controller = require('./fac.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/facturacion/generar:
 *   post:
 *     summary: Generar comprobante de pago
 *     tags: [Facturación]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_pago:
 *                 type: string
 *               id_paciente:
 *                 type: string
 *               tipo_comprobante:
 *                 type: string
 *               ruc_dni:
 *                 type: string
 *               nombre_razon_social:
 *                 type: string
 *               monto_total:
 *                 type: number
 *     responses:
 *       201:
 *         description: Comprobante generado
 */
router.post('/generar', verifyToken, requireRole('Recepcionista'), controller.generar);

module.exports = router;
