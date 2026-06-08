const router = require('express').Router();
const controller = require('./citas.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/citas:
 *   post:
 *     summary: Reservar una nueva cita médica
 *     tags: [Citas]
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
 *               especialidad:
 *                 type: string
 *               fecha_hora:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Cita reservada correctamente
 */
router.post('/', verifyToken, requireRole('Recepcionista'), controller.reservar);

/**
 * @swagger
 * /api/v1/citas/{id}/cancelar:
 *   post:
 *     summary: Cancelar una cita médica
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               motivo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cita cancelada
 */
router.post('/:id/cancelar', verifyToken, requireRole('Recepcionista', 'Médico'), controller.cancelar);

/**
 * @swagger
 * /api/v1/citas/{id}:
 *   get:
 *     summary: Obtener detalle de una cita
 *     tags: [Citas]
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
 *         description: Detalle de la cita
 */
router.get('/:id', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.obtenerPorId);

module.exports = router;
