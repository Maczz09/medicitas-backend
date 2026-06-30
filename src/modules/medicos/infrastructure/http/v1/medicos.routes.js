const router = require('express').Router();
const controller = require('./medicos.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/medicos:
 *   post:
 *     summary: Crear un nuevo médico
 *     tags: [Médicos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cmp:
 *                 type: string
 *               nombres:
 *                 type: string
 *               apellidos:
 *                 type: string
 *               especialidad:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       201:
 *         description: Médico creado
 */
router.get('/', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.getAll);
router.post('/', verifyToken, requireRole('Auditor'), controller.createMedico);

/**
 * @swagger
 * /api/v1/medicos/{id}/disponibilidad:
 *   get:
 *     summary: Verificar disponibilidad del médico
 *     tags: [Médicos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: fecha_hora
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Resultado de disponibilidad
 */
router.get('/:id/disponibilidad', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.getDisponibilidad);
router.get('/:id/slots', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.getSlotsForDate);
router.post('/:id/horarios', verifyToken, requireRole('Médico', 'Auditor'), controller.registrarHorarios);
router.post('/:id/bloqueos', verifyToken, requireRole('Médico', 'Auditor'), controller.registrarBloqueo);

// CRUD completo de médicos (Auditor)
router.get('/:id', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.getById);
router.put('/:id', verifyToken, requireRole('Auditor'), controller.updateMedico);

module.exports = router;
