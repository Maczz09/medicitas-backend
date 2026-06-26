const express = require('express');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { correlationMiddleware } = require('../../../shared/infrastructure/correlation.middleware');
const { checkIdempotency } = require('../../../shared/infrastructure/api_idempotency.middleware');

const { SegurosController } = require('../adapters/in/SegurosController');
const { CoberturasMySQLRepository } = require('../adapters/out/repositories/CoberturasMySQLRepository');
const { AseguradoraMockAdapter } = require('../adapters/out/gateway/AseguradoraMockAdapter');
const { AseguradoraAxiosAdapter } = require('../adapters/out/gateway/AseguradoraAxiosAdapter');
const { PacienteHttpAdapter } = require('../adapters/out/http/PacienteHttpAdapter');
const { OutboxMySQLPublisher } = require('../adapters/out/events/OutboxMySQLPublisher');

const { ValidarCoberturaUseCase } = require('../application/use-cases/ValidarCoberturaUseCase');
const { ConsultarValidacionUseCase } = require('../application/use-cases/ConsultarValidacionUseCase');

const dbPool = require('../../../config/database');
const logger = require('../../../shared/logger/logger');

// ── 1. Adaptadores ────────────────────────────────────────────────────────────
const coberturaRepo     = new CoberturasMySQLRepository(dbPool);
const pacienteValidator = new PacienteHttpAdapter();
const eventPublisher    = new OutboxMySQLPublisher();

// Selector de implementación — configurable vía variable de entorno
const useMockSeguro = process.env.USE_MOCK_SEGURO !== 'false';
const aseguradoraGateway = useMockSeguro 
  ? new AseguradoraMockAdapter() 
  : new AseguradoraAxiosAdapter();

const getConnection = async () => await dbPool.getConnection();

// ── 2. Casos de Uso ───────────────────────────────────────────────────────────
const validarCoberturaUseCase = new ValidarCoberturaUseCase({
  coberturaRepository: coberturaRepo,
  aseguradoraGateway,
  pacienteValidator,
  eventPublisher,
  getConnection
});

const consultarValidacionUseCase = new ConsultarValidacionUseCase({
  coberturaRepository: coberturaRepo
});

// ── 3. Controlador ────────────────────────────────────────────────────────────
const controller = new SegurosController({
  validarCoberturaUseCase,
  consultarValidacionUseCase
});

// ── 3b. Recovery Replay — se dispara cuando el CB de Seguros cierra (servicio recuperado) ──
// Busca validaciones PENDIENTE (generadas por fallback mientras el CB estaba abierto)
// y las re-evalúa contra la aseguradora real. Si el resultado cambia, se actualiza
// el registro para que quede trazabilidad — no se revierte ningún pago automáticamente.
const RECOVERY_LIMIT_SEGUROS = 20;
aseguradoraGateway.registrarRecuperacion(async () => {
  const pendientes = await coberturaRepo.findPendientes(RECOVERY_LIMIT_SEGUROS);
  if (pendientes.length === 0) return;

  logger.info({ total: pendientes.length }, '[Seguros] Recovery replay: reevaluando coberturas PENDIENTE');

  for (const c of pendientes) {
    try {
      const resultado = await aseguradoraGateway.validarPoliza({
        idPaciente:   c.idPaciente,
        idAseguradora: c.idAseguradora,
        numeroPoliza: c.numeroPoliza,
        tipoConsulta: c.tipoConsulta,
      });

      // Si sigue siendo fallback, el CB volvió a abrirse — dejar para el próximo ciclo
      if (resultado.esFallback) continue;

      await coberturaRepo.actualizarResultado(c.id, resultado);
      logger.info(
        { id: c.id, anterior: 'PENDIENTE', nuevo: resultado.estadoCobertura },
        '[Seguros] Cobertura reevaluada — revisar manualmente si el pago asociado requiere ajuste'
      );
    } catch (err) {
      logger.error({ err, id: c.id }, '[Seguros] Recovery replay: fallo individual — continúa con siguiente');
    }
  }
});

// ── 4. Rutas ──────────────────────────────────────────────────────────────────
const router = express.Router();

router.use(correlationMiddleware);

// ── Listado de validaciones de cobertura (admin/auditoría) — paginado ──────────
router.get('/', verifyToken, requireRole('Recepcionista', 'Auditor'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const estado = req.query.estado;
    const where = estado ? 'WHERE v.estado_cobertura = ?' : '';
    const params = estado ? [estado] : [];

    const [countRows] = await dbPool.query(`SELECT COUNT(*) AS total FROM svc_seg.validaciones_cobertura v ${where}`, params);
    const [rows] = await dbPool.query(
      `SELECT v.id, v.id_paciente, v.id_aseguradora, v.numero_poliza, v.tipo_consulta,
              v.estado_cobertura, v.porcentaje_cobertura, v.codigo_autorizacion, v.vigencia,
              v.es_fallback, v.correlation_id, v.created_at,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_seg.validaciones_cobertura v
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = v.id_paciente
       ${where}
       ORDER BY v.created_at DESC
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
 *   name: Seguros
 *   description: Integración con aseguradoras y validación de cobertura
 */

/**
 * @swagger
 * /api/v1/coberturas/validar:
 *   post:
 *     summary: Validar la cobertura de un paciente con la aseguradora
 *     tags: [Seguros]
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
 *               - idAseguradora
 *               - numeroPoliza
 *               - tipoConsulta
 *             properties:
 *               idPaciente:
 *                 type: string
 *               idAseguradora:
 *                 type: string
 *               numeroPoliza:
 *                 type: string
 *               tipoConsulta:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validación completada (puede ser APROBADA, RECHAZADA o PENDIENTE)
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Paciente no encontrado
 *       500:
 *         description: Error interno al comunicarse con la aseguradora
 */
router.post('/validar',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor', 'INTERNAL']),
  checkIdempotency,
  controller.validarCobertura
);

/**
 * @swagger
 * /api/v1/coberturas/{id}:
 *   get:
 *     summary: Consultar el resultado de una validación de cobertura existente
 *     tags: [Seguros]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la validación
 *     responses:
 *       200:
 *         description: Detalles de la validación
 *       404:
 *         description: Validación no encontrada
 */
router.get('/:id',
  verifyToken,
  requireRole(['Recepcionista', 'Auditor', 'INTERNAL']),
  controller.consultarValidacion
);

module.exports = router;
