const router = require('express').Router();
const controller = require('./auth.controller');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Iniciar sesión y obtener tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 *       401:
 *         description: Credenciales inválidas o cuenta bloqueada
 */
router.post('/login', controller.login);

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Obtener nuevo access token usando refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tokens actualizados
 *       422:
 *         description: Token inválido o expirado
 */
router.post('/refresh', controller.refreshToken);

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Solicitar OTP para recuperación de contraseña
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP enviado al correo
 *       404:
 *         description: Correo no encontrado
 */
router.post('/forgot-password', controller.generateOTP);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Restablecer contraseña con OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               otpCode:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contraseña restablecida
 *       422:
 *         description: OTP incorrecto o expirado
 */
router.post('/reset-password', controller.resetPassword);

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Registro de usuarios internos (Solo Auditor/Recepcionista)
 *     tags: [Auth]
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
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               rolNombre:
 *                 type: string
 *                 enum: [Recepcionista, Médico, Auditor]
 *     responses:
 *       201:
 *         description: Usuario creado
 *       403:
 *         description: Sin permisos
 */
router.post('/register', verifyToken, requireRole('Auditor', 'Recepcionista'), controller.register);

/**
 * @swagger
 * /api/v1/auth/usuarios:
 *   get:
 *     summary: Listar usuarios del sistema (paginado + búsqueda) — Solo Auditor
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.get('/usuarios', verifyToken, requireRole('Auditor', 'Médico', 'Recepcionista'), controller.listUsuarios);

/**
 * @swagger
 * /api/v1/auth/usuarios/{id}:
 *   put:
 *     summary: Editar un usuario (nombre, apellido, email, rol, activo) — Auditor/Recepcionista
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.put('/usuarios/:id', verifyToken, requireRole('Auditor'), controller.updateUsuario);

/**
 * @swagger
 * /api/v1/auth/usuarios/{id}/rol:
 *   put:
 *     summary: Asignar un nuevo rol a un usuario (Solo Auditor)
 *     tags: [Auth]
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
 *               rolNombre:
 *                 type: string
 *                 enum: [Recepcionista, Médico, Auditor]
 *     responses:
 *       200:
 *         description: Rol actualizado
 *       403:
 *         description: Sin permisos
 */
router.put('/usuarios/:id/rol', verifyToken, requireRole('Auditor'), controller.assignRole);

module.exports = router;
