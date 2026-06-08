const router = require('express').Router();
const controller = require('./seguros.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/seguros/validar-cobertura:
 *   get:
 *     summary: Validar la cobertura del seguro para un paciente
 *     tags: [Seguros]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: codigoSeguro
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: especialidad
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Datos de cobertura validados
 */
router.get('/validar-cobertura', verifyToken, controller.validarCobertura);

module.exports = router;
