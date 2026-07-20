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
    const q = req.query.q ? req.query.q.trim() : '';
    const idPaciente = req.query.idPaciente;
    const condiciones = [];
    const params = [];
    if (estado) { condiciones.push('n.estado = ?'); params.push(estado); }
    // Búsqueda por texto libre sobre columnas propias de notificaciones. Para
    // "buscar por paciente" el frontend resuelve el nombre a un id exacto vía
    // el PatientPicker/endpoint de pacientes y lo manda como idPaciente.
    if (q) {
      condiciones.push('(n.tipo_evento LIKE ? OR n.telefono_destino LIKE ? OR n.contenido LIKE ? OR n.referencia_gateway LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (idPaciente) { condiciones.push('n.id_paciente = ?'); params.push(idPaciente); }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const [countRows] = await dbPool.query(
      `SELECT COUNT(*) AS total FROM svc_not.mensajes_sms n
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = n.id_paciente
       ${where}`,
      params,
    );
    const [rows] = await dbPool.query(
      `SELECT n.id_mensaje, n.id_evento_origen, n.tipo_evento, n.id_paciente, n.telefono_destino,
              n.contenido, n.estado, n.referencia_gateway, n.intentos, n.error_msg,
              n.correlation_id, n.created_at, n.enviado_en,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_not.mensajes_sms n
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = n.id_paciente
       ${where}
       ORDER BY n.created_at DESC
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
