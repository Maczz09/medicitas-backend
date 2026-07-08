const router = require('express').Router();
const controller = require('../adapters/in/MedicosController');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { soloMedicoPropietario } = require('../../../shared/infrastructure/resourceAuth.middleware');

/**
 * @swagger
 * /api/v2/medicos:
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
 * /api/v2/medicos/{id}/disponibilidad:
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
router.post('/:id/horarios', verifyToken, requireRole('Médico', 'Auditor'), soloMedicoPropietario('id'), controller.registrarHorarios);
router.post('/:id/bloqueos', verifyToken, requireRole('Médico', 'Auditor'), soloMedicoPropietario('id'), controller.registrarBloqueo);

// Fase 2 del módulo horarios — semana específica (:semanaInicio = lunes de
// esa semana, YYYY-MM-DD). Aditivo, no reemplaza los endpoints de arriba.

/**
 * @swagger
 * /api/v2/medicos/{id}/horarios/semanas/{semanaInicio}:
 *   get:
 *     summary: Consultar el horario de una semana específica (con fallback a la plantilla base)
 *     tags: [Médicos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: semanaInicio
 *         required: true
 *         description: Lunes de la semana a consultar (YYYY-MM-DD). Se normaliza automáticamente al lunes de su semana si no lo es.
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Horario efectivo de la semana — `origen` indica si es un override explícito (SEMANA) o el respaldo (PLANTILLA)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     semanaInicio:
 *                       type: string
 *                     origen:
 *                       type: string
 *                       enum: [PLANTILLA, SEMANA]
 *                     dias:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           dia_semana:
 *                             type: integer
 *                           hora_inicio:
 *                             type: string
 *                           hora_fin:
 *                             type: string
 *                           duracion_cita_min:
 *                             type: integer
 *                           activo:
 *                             type: boolean
 *   put:
 *     summary: Definir (crear o reemplazar por completo) el horario de una semana específica
 *     tags: [Médicos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: semanaInicio
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dias:
 *                 type: array
 *                 description: Solo los días activos de esa semana — un día omitido queda inactivo ese día (no cae a la plantilla).
 *                 items:
 *                   type: object
 *                   properties:
 *                     dia_semana:
 *                       type: integer
 *                     hora_inicio:
 *                       type: string
 *                     hora_fin:
 *                       type: string
 *                     duracion_cita_min:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Horario de la semana registrado
 */
router.get('/:id/horarios/semanas/:semanaInicio', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.getHorarioSemana);
router.put('/:id/horarios/semanas/:semanaInicio', verifyToken, requireRole('Médico', 'Auditor'), soloMedicoPropietario('id'), controller.definirHorarioSemana);

// CRUD completo de médicos (Auditor)
router.get('/:id', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), controller.getById);
router.put('/:id', verifyToken, requireRole('Auditor'), controller.updateMedico);

module.exports = router;
