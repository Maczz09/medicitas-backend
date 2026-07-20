const express = require('express');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { correlationMiddleware } = require('../../../shared/infrastructure/correlation.middleware');
const { checkIdempotency } = require('../../../shared/infrastructure/api_idempotency.middleware');
const { validate } = require('../../../shared/infrastructure/validate.middleware');
const { validarCoberturaSchema } = require('../../../shared/infrastructure/schemas');

const { SegurosController } = require('../adapters/in/SegurosController');
const { CoberturasMySQLRepository } = require('../adapters/out/repositories/CoberturasMySQLRepository');
const { AseguradoraMockAdapter } = require('../adapters/out/gateway/AseguradoraMockAdapter');
const { AseguradoraAxiosAdapter } = require('../adapters/out/gateway/AseguradoraAxiosAdapter');
const { PacienteHttpAdapter } = require('../adapters/out/http/PacienteHttpAdapter');
const { OutboxMySQLPublisher } = require('../adapters/out/events/OutboxMySQLPublisher');

const { ValidarCoberturaUseCase } = require('../application/use-cases/ValidarCoberturaUseCase');
const { ConsultarValidacionUseCase } = require('../application/use-cases/ConsultarValidacionUseCase');
const { Cobertura } = require('../domain/entities/Cobertura');

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

// ── 3b. Recovery Replay — reevalúa validaciones que quedaron con dato
// degradado (PENDIENTE genérico, o APROBADA/RECHAZADA servida desde el caché
// de contingencia de seguros-fallback-service con es_fallback=1) contra la
// aseguradora real. Se dispara al cerrar el CB de Seguros Y por sondeo
// periódico — mismo motivo que prescripciones.routes.js: un CB half-open solo
// cierra si alguien dispara una llamada, y sin una validación nueva nadie lo
// haría. Publica el evento de dominio correspondiente en la MISMA transacción
// que la corrección (igual que ValidarCoberturaUseCase), a diferencia de la
// versión anterior de este replay, que actualizaba la fila en silencio.
const RECOVERY_LIMIT_SEGUROS = 20;
// 15s (no 60s): sin que el CB llegue a abrir — una validación única hace ~3
// llamadas, por debajo de CB_VOLUME_THRESHOLD=5, así que el disparo por cierre
// de CB nunca ocurre y este sondeo es el ÚNICO camino de reconciliación. A 15s,
// combinado con el orden newest-first, una validación recién hecha se actualiza
// sola en segundos al recuperarse la aseguradora, no en minutos.
const REPLAY_SEGUROS_INTERVAL_MS = parseInt(process.env.REPLAY_SEGUROS_INTERVAL_MS || '15000');

let _replaySegurosEnCurso = false;
async function replayCoberturasDegradadas() {
  if (_replaySegurosEnCurso) return;
  _replaySegurosEnCurso = true;
  try {
    const pendientes = await coberturaRepo.findPendientes(RECOVERY_LIMIT_SEGUROS);
    if (pendientes.length === 0) return;

    logger.info({ total: pendientes.length }, '[Seguros] Recovery replay: reevaluando coberturas degradadas');

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

        const cobertura = new Cobertura({
          id: c.id,
          idPaciente: c.idPaciente,
          idAseguradora: c.idAseguradora,
          numeroPoliza: c.numeroPoliza,
          tipoConsulta: c.tipoConsulta,
          estadoCobertura: resultado.estadoCobertura,
          porcentajeCobertura: resultado.porcentajeCobertura,
          codigoAutorizacion: resultado.codigoAutorizacion,
          vigencia: resultado.vigencia,
          esFallback: false,
          correlationId: c.correlationId,
        });

        const conn = await getConnection();
        await conn.beginTransaction();
        try {
          const affectedRows = await coberturaRepo.actualizarResultado(c.id, resultado, conn);
          // 0 filas = otro worker del clúster ya reconcilió esta misma fila
          // entre el findPendientes() y este punto — no publicar un evento
          // duplicado por algo que ya se corrigió y notificó una vez.
          if (affectedRows > 0) {
            await eventPublisher.publish(conn, cobertura.eventoAPublicar(), {
              idValidacion:        cobertura.id,
              idPaciente:          cobertura.idPaciente,
              idAseguradora:       cobertura.idAseguradora,
              numeroPoliza:        cobertura.numeroPoliza,
              estadoCobertura:     cobertura.estadoCobertura,
              porcentajeCobertura: cobertura.porcentajeCobertura,
              codigoAutorizacion:  cobertura.codigoAutorizacion,
              vigencia:            cobertura.vigencia,
              esFallback:          cobertura.esFallback,
            }, c.correlationId);
          }
          await conn.commit();
          if (affectedRows > 0) {
            logger.info(
              { id: c.id, nuevo: resultado.estadoCobertura },
              '[Seguros] Cobertura reevaluada y evento publicado'
            );
          }
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }
      } catch (err) {
        logger.error({ err, id: c.id }, '[Seguros] Recovery replay: fallo individual — continúa con siguiente');
      }
    }
  } catch (err) {
    logger.error({ err }, '[Seguros] Error en recovery replay de coberturas');
  } finally {
    _replaySegurosEnCurso = false;
  }
}

aseguradoraGateway.registrarRecuperacion(replayCoberturasDegradadas);
const _replaySegurosTimer = setInterval(replayCoberturasDegradadas, REPLAY_SEGUROS_INTERVAL_MS);
_replaySegurosTimer.unref(); // No mantiene vivo el proceso en tests/shutdown

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
    const q = req.query.q ? req.query.q.trim() : '';
    const idPaciente = req.query.idPaciente;
    const condiciones = [];
    const params = [];
    if (estado) { condiciones.push('v.estado_cobertura = ?'); params.push(estado); }
    // Búsqueda por texto libre solo sobre columnas propias de coberturas. Para
    // "buscar por paciente" el frontend resuelve el nombre a un id exacto vía
    // el PatientPicker/endpoint de pacientes y lo manda como idPaciente.
    if (q) {
      condiciones.push('(v.numero_poliza LIKE ? OR v.tipo_consulta LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (idPaciente) { condiciones.push('v.id_paciente = ?'); params.push(idPaciente); }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

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
 * /api/v2/coberturas/validar:
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
  validate(validarCoberturaSchema),
  controller.validarCobertura
);

/**
 * @swagger
 * /api/v2/coberturas/{id}:
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

/**
 * Recibe notificaciones de eventos de negocio desde seguros-fallback-service
 * (cache-aside upsert, lectura de fallback servida, reconciliación) y las
 * inserta en el mismo outbox transaccional de svc_seg — de ahí salen a
 * RabbitMQ (medicitas.events) igual que cualquier otro evento del módulo, y
 * el consumer de auditoría ya existente las captura automáticamente. Ese
 * servicio nunca habla AMQP directo: no tiene ni necesita credenciales de
 * RabbitMQ, solo este token interno compartido.
 */
router.post('/interno/eventos-fallback',
  verifyToken,
  requireRole(['INTERNAL']),
  async (req, res, next) => {
    try {
      const { tipoEvento, payload, correlationId } = req.body || {};
      if (!tipoEvento || !payload) {
        return res.status(400).json({
          codigo: 'DATOS_INCOMPLETOS',
          mensaje: 'tipoEvento y payload son obligatorios.',
          correlationId: req.correlationId || correlationId || null,
          timestamp: new Date().toISOString(),
        });
      }

      const conn = await getConnection();
      try {
        await conn.beginTransaction();
        await eventPublisher.publish(conn, tipoEvento, payload, correlationId || req.correlationId);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      res.status(202).json({ recibido: true, correlationId: req.correlationId, timestamp: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
