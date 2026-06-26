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

// ── Listado de TODAS las notificaciones SMS (admin/auditoría) — paginado ───────
router.get('/', verifyToken, requireRole('Auditor'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const estado = req.query.estado;
    const where = estado ? 'WHERE estado = ?' : '';
    const params = estado ? [estado] : [];

    const [countRows] = await dbPool.query(`SELECT COUNT(*) AS total FROM svc_not.mensajes_sms ${where}`, params);
    const [rows] = await dbPool.query(
      `SELECT id_mensaje, id_evento_origen, tipo_evento, telefono_destino, contenido, estado,
              intentos, error_msg, correlation_id, created_at, enviado_en
       FROM svc_not.mensajes_sms
       ${where}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total: countRows[0].total, page, limit, totalPages: Math.ceil(countRows[0].total / limit) },
      correlationId: req.correlationId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
