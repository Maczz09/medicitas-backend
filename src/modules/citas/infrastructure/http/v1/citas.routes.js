const express = require('express');
const { verifyToken } = require('../../../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../../../shared/infrastructure/rbac.middleware');
const { correlationMiddleware } = require('../../../../../shared/infrastructure/correlation.middleware');
const { checkIdempotency } = require('../../../../../shared/infrastructure/api_idempotency.middleware');

// Inyección de dependencias manual (o con un contenedor)
const { CitasController } = require('./citas.controller');

const { CitasMySQLRepository } = require('../../../adapters/out/repositories/CitasMySQLRepository');
const { DisponibilidadRedisCache } = require('../../../adapters/out/cache/DisponibilidadRedisCache');
const { PacienteHttpAdapter } = require('../../../adapters/out/http/PacienteHttpAdapter');
const { MedicoDisponibilidadDBAdapter } = require('../../../adapters/out/http/MedicoDisponibilidadDBAdapter');
const { OutboxMySQLPublisher } = require('../../../adapters/out/events/OutboxMySQLPublisher');

const { ReservarCitaUseCase } = require('../../../application/use-cases/ReservarCitaUseCase');
const { CancelarCitaUseCase } = require('../../../application/use-cases/CancelarCitaUseCase');
const { ReprogramarCitaUseCase } = require('../../../application/use-cases/ReprogramarCitaUseCase');
const { RegistrarIngresoUseCase } = require('../../../application/use-cases/RegistrarIngresoUseCase');
const { RevertirIngresoUseCase } = require('../../../application/use-cases/RevertirIngresoUseCase');
const { CompletarCitaUseCase } = require('../../../application/use-cases/CompletarCitaUseCase');
const { ConsultarCitaUseCase } = require('../../../application/use-cases/ConsultarCitaUseCase');

const dbPool = require('../../../../../config/database');

// Instancias de adaptadores
const citasRepo = new CitasMySQLRepository();
const medicoAdapter = new MedicoDisponibilidadDBAdapter();
const cacheAdapter = new DisponibilidadRedisCache(medicoAdapter);
const pacienteAdapter = new PacienteHttpAdapter();
const eventPublisher = new OutboxMySQLPublisher();

const getConnection = async () => await dbPool.getConnection();

// Instancias de Casos de Uso
const reservarCitaUseCase = new ReservarCitaUseCase({
  citasRepository: citasRepo,
  disponibilidadCache: cacheAdapter,
  pacienteValidator: pacienteAdapter,
  eventPublisher,
  getConnection
});

const cancelarCitaUseCase = new CancelarCitaUseCase({
  citasRepository: citasRepo,
  disponibilidadCache: cacheAdapter,
  eventPublisher,
  getConnection
});

const reprogramarCitaUseCase = new ReprogramarCitaUseCase({
  citasRepository: citasRepo,
  disponibilidadCache: cacheAdapter,
  eventPublisher,
  getConnection
});

const registrarIngresoUseCase = new RegistrarIngresoUseCase({
  citasRepository: citasRepo,
  eventPublisher,
  getConnection
});

const revertirIngresoUseCase = new RevertirIngresoUseCase({
  citasRepository: citasRepo,
  eventPublisher,
  getConnection
});

const completarCitaUseCase = new CompletarCitaUseCase({
  citasRepository: citasRepo,
  getConnection
});

const consultarCitaUseCase = new ConsultarCitaUseCase({
  citasRepository: citasRepo
});

// Controlador
const controller = new CitasController({
  reservarCitaUseCase,
  cancelarCitaUseCase,
  reprogramarCitaUseCase,
  registrarIngresoUseCase,
  revertirIngresoUseCase,
  completarCitaUseCase,
  consultarCitaUseCase
});

const router = express.Router();

router.use(correlationMiddleware);

// ── Listado de citas (admin/auditoría) — paginado + filtro por estado ──────────
router.get('/', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const estado = req.query.estado;
    const where = estado ? 'WHERE c.estado = ?' : '';
    const params = estado ? [estado] : [];

    const [countRows] = await dbPool.query(`SELECT COUNT(*) AS total FROM svc_cit.citas c ${where}`, params);
    const [rows] = await dbPool.query(
      `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad, c.estado,
              c.correlation_id, c.created_at,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
              CONCAT(m.nombre, ' ', m.apellido) AS medico_nombre
       FROM svc_cit.citas c
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
       LEFT JOIN svc_med.medicos m ON m.id_medico = c.id_medico
       ${where}
       ORDER BY c.fecha_hora DESC
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

/**
 * @swagger
 * tags:
 *   name: Citas
 *   description: Endpoints para la gestión de citas médicas
 */

/**
 * @swagger
 * /api/v1/citas:
 *   post:
 *     summary: Reserva una nueva cita
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idPaciente
 *               - idMedico
 *               - fechaHora
 *               - especialidad
 *             properties:
 *               idPaciente:
 *                 type: string
 *               idMedico:
 *                 type: string
 *               fechaHora:
 *                 type: string
 *                 format: date-time
 *               especialidad:
 *                 type: string
 *     responses:
 *       201:
 *         description: Cita reservada exitosamente
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Permisos insuficientes
 *       409:
 *         description: Conflicto de horario o desincronización
 */
router.post('/',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor']),
  checkIdempotency,
  controller.reservarCita
);

/**
 * @swagger
 * /api/v1/citas/{id}:
 *   get:
 *     summary: Obtiene los detalles de una cita
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     responses:
 *       200:
 *         description: Detalles de la cita
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Cita no encontrada
 */
router.get('/:id',
  verifyToken,
  requireRole(['Recepcionista', 'Médico', 'Auditor', 'INTERNAL']),
  controller.consultarCita
);

/**
 * @swagger
 * /api/v1/citas/{id}/cancelar:
 *   patch:
 *     summary: Cancela una cita existente
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     requestBody:
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
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Cita no encontrada
 *       409:
 *         description: Transición de estado inválida
 */
router.patch('/:id/cancelar',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor']),
  controller.cancelarCita
);

/**
 * @swagger
 * /api/v1/citas/{id}/reprogramar:
 *   patch:
 *     summary: Reprograma una cita a un nuevo horario y/o médico
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nuevaFechaHora
 *             properties:
 *               nuevaFechaHora:
 *                 type: string
 *                 format: date-time
 *               idMedico:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cita reprogramada
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Cita no encontrada
 *       409:
 *         description: Conflicto de horario o estado inválido
 */
router.patch('/:id/reprogramar',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor']),
  controller.reprogramarCita
);

/**
 * @swagger
 * /api/v1/citas/{id}/ingreso:
 *   post:
 *     summary: Registra el ingreso del paciente a la cita (En Atención)
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     responses:
 *       200:
 *         description: Ingreso registrado exitosamente
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Cita no encontrada
 *       409:
 *         description: Transición de estado inválida
 */
router.post('/:id/ingreso',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor']),
  controller.registrarIngreso
);

router.patch('/:id/revertir-ingreso',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor']),
  controller.revertirIngreso
);

// INTERNAL: Llamado por SVC-HCL-002
/**
 * @swagger
 * /api/v1/citas/{id}/completar:
 *   patch:
 *     summary: Completa una cita médica (Llamada interna por SVC-HCL)
 *     tags: [Citas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     responses:
 *       200:
 *         description: Cita completada
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Solo INTERNAL
 *       404:
 *         description: Cita no encontrada
 */
router.patch('/:id/completar',
  verifyToken,
  requireRole(['INTERNAL', 'Auditor']),
  controller.completarCita
);

module.exports = router;
