const router = require('express').Router();
const controller = require('./pacientes.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/pacientes:
 *   get:
 *     summary: Buscar y listar pacientes (paginado)
 *     tags: [Pacientes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Término de búsqueda (nombre, apellido o número de documento)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Cantidad de resultados por página
 *     responses:
 *       200:
 *         description: Lista paginada de pacientes
 */
router.get('/', verifyToken, requireRole('Recepcionista', 'Auditor', 'Médico'), controller.getAll);

/**
 * @swagger
 * /api/v1/pacientes/{id}:
 *   get:
 *     summary: Obtener perfil de paciente por ID
 *     tags: [Pacientes]
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
 *         description: Datos del paciente
 */
router.get('/:id', verifyToken, requireRole('Recepcionista', 'Auditor', 'Médico'), controller.getById);

/**
 * @swagger
 * /api/v1/pacientes:
 *   post:
 *     summary: Registrar un nuevo paciente
 *     tags: [Pacientes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               apellido:
 *                 type: string
 *               tipo_documento:
 *                 type: string
 *                 enum: [DNI, CE, PASAPORTE]
 *               numero_documento:
 *                 type: string
 *               fecha_nacimiento:
 *                 type: string
 *                 format: date
 *               sexo:
 *                 type: string
 *                 enum: [M, F, Otro]
 *               telefono:
 *                 type: string
 *               email:
 *                 type: string
 *               direccion:
 *                 type: string
 *     responses:
 *       201:
 *         description: Paciente registrado con éxito
 */
router.post('/', verifyToken, requireRole('Recepcionista', 'Auditor'), controller.create);

/**
 * @swagger
 * /api/v1/pacientes/{id}/contacto:
 *   put:
 *     summary: Actualizar datos de contacto del paciente
 *     tags: [Pacientes]
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
 *               telefono:
 *                 type: string
 *               email:
 *                 type: string
 *               direccion:
 *                 type: string
 *     responses:
 *       200:
 *         description: Evento de actualización publicado
 */
router.put('/:id/contacto', verifyToken, requireRole('Recepcionista', 'Auditor'), controller.updateContact);

/**
 * @swagger
 * /api/v1/pacientes/{id}/estado:
 *   patch:
 *     summary: Desactivar o activar a un paciente (Soft Delete)
 *     tags: [Pacientes]
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
 *               activo:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Estado actualizado
 */
router.patch('/:id/estado', verifyToken, requireRole('Recepcionista', 'Auditor'), controller.toggleStatus);

module.exports = router;
