const router = require('express').Router();
const controller = require('./pre.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/prescripciones:
 *   post:
 *     summary: Emitir una receta médica
 *     tags: [Prescripciones]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_paciente:
 *                 type: string
 *               id_medico:
 *                 type: string
 *               medicamento:
 *                 type: string
 *               dosis:
 *                 type: string
 *               duracion_dias:
 *                 type: number
 *               instrucciones:
 *                 type: string
 *     responses:
 *       201:
 *         description: Receta emitida exitosamente
 */
router.post('/', verifyToken, requireRole('Médico'), controller.emitirReceta);

module.exports = router;
