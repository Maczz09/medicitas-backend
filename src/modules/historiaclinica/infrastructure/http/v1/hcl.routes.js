const router = require('express').Router();
const controller = require('./hcl.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/historia-clinica/expedientes:
 *   post:
 *     summary: Crear un expediente clínico para un paciente
 *     tags: [Historia Clínica]
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
 *               antecedentes_familiares:
 *                 type: string
 *               alergias:
 *                 type: string
 *     responses:
 *       201:
 *         description: Expediente creado exitosamente
 */
router.post('/expedientes', verifyToken, requireRole('Recepcionista', 'Médico'), controller.crearExpediente);

/**
 * @swagger
 * /api/v1/historia-clinica/pacientes/{idPaciente}/encuentros:
 *   post:
 *     summary: Registrar un nuevo encuentro clínico (atención médica)
 *     tags: [Historia Clínica]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idPaciente
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
 *               id_medico:
 *                 type: string
 *               motivo_consulta:
 *                 type: string
 *               notas_evolucion:
 *                 type: string
 *               diagnostico_cie10:
 *                 type: string
 *     responses:
 *       201:
 *         description: Encuentro clínico registrado
 */
router.post('/pacientes/:idPaciente/encuentros', verifyToken, requireRole('Médico'), controller.registrarEncuentro);

module.exports = router;
