const { Router } = require('express');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');

const { MensajesSMSMySQLRepository }   = require('../adapters/out/repositories/MensajesSMSMySQLRepository');
const { ConsultarSMSPacienteUseCase }  = require('../application/use-cases/ConsultarSMSPacienteUseCase');
const { NotificacionesController }     = require('../adapters/in/NotificacionesController');
const dbPool = require('../../../config/database');

const controller = new NotificacionesController({
  consultarSMSUseCase: new ConsultarSMSPacienteUseCase({
    mensajesSMSRepository: new MensajesSMSMySQLRepository(dbPool),
  }),
});

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Notificaciones
 *   description: Consultas de SMS (Solo lectura - Requiere rol AUDITOR)
 */

/**
 * @swagger
 * /notificaciones/sms/paciente/{idPaciente}:
 *   get:
 *     summary: Obtener historial de SMS enviados a un paciente
 *     tags: [Notificaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idPaciente
 *         schema:
 *           type: string
 *         required: true
 *         description: ID del paciente
 *       - in: query
 *         name: pagina
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: porPagina
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Cantidad de resultados por página
 *     responses:
 *       200:
 *         description: Historial obtenido exitosamente
 *       400:
 *         description: Paginación inválida
 *       403:
 *         description: No tiene permisos (requiere AUDITOR)
 */
// Solo AUDITOR puede consultar el historial de SMS enviados a un paciente
router.get('/sms/paciente/:idPaciente', verifyToken, requireRole(['AUDITOR']), controller.consultarPorPaciente);

module.exports = router;
