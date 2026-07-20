const { Router } = require('express');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { validate } = require('../../../shared/infrastructure/validate.middleware');
const { confirmarPagoSchema } = require('../../../shared/infrastructure/schemas');
const { requireIdempotencyKey } = require('../../../shared/infrastructure/api_idempotency.middleware');

const { PagosMySQLRepository }    = require('../adapters/out/repositories/PagosMySQLRepository');
const { CitaHttpAdapter }         = require('../adapters/out/http/CitaHttpAdapter');
const { CoberturaHttpAdapter }    = require('../adapters/out/http/CoberturaHttpAdapter');
const { OutboxMySQLPublisher }    = require('../adapters/out/events/OutboxMySQLPublisher');

const { ConfirmarPagoUseCase }         = require('../application/use-cases/ConfirmarPagoUseCase');
const { ReversarPagoUseCase }          = require('../application/use-cases/ReversarPagoUseCase');
const { ConsultarPagoUseCase }         = require('../application/use-cases/ConsultarPagoUseCase');
const { ConsultarPagoPorCitaUseCase }  = require('../application/use-cases/ConsultarPagoPorCitaUseCase');
const { PagosController }             = require('../adapters/in/PagosController');

const dbPool = require('../../../config/database');
const logger = require('../../../shared/logger/logger');

const pool   = dbPool;
const connFn = async () => await dbPool.getConnection();
const repo   = new PagosMySQLRepository(pool);
const cita   = new CitaHttpAdapter();
const cob    = new CoberturaHttpAdapter();
const outbox = new OutboxMySQLPublisher(connFn);

const controller = new PagosController({
  confirmarUseCase: new ConfirmarPagoUseCase({
    pagosRepository: repo, citaValidator: cita,
    coberturaValidator: cob, eventPublisher: outbox, getConnection: connFn,
  }),
  reversarUseCase: new ReversarPagoUseCase({
    pagosRepository: repo, eventPublisher: outbox, getConnection: connFn,
    citaCompensador: cita,
  }),
  consultarUseCase:      new ConsultarPagoUseCase({ pagosRepository: repo }),
  consultarPorCitaUseCase: new ConsultarPagoPorCitaUseCase({ pagosRepository: repo }),
});

// ── Recovery Replay — reverifica pagos que se confirmaron con Coberturas
// inalcanzable (cobertura_verificada=0). Mismo patrón que seguros.routes.js:
// se dispara al cerrar el CB de Pagos→Coberturas Y por sondeo periódico (un
// CB half-open solo se prueba si alguien hace una llamada nueva; sin un pago
// nuevo con cobertura, nadie lo dispararía). A diferencia de Seguros, aquí NO
// se corrige el dato mostrado — el pago ya está cobrado — así que si la
// cobertura real NO coincide con lo declarado, el pago NO se revierte
// automáticamente (requiere criterio humano, mismo principio ya establecido
// en seguros.routes.js): se deja constancia fuerte (log de error + evento
// propio) para que el auditor lo revise.
const RECOVERY_LIMIT_PAGOS = 20;
const REPLAY_PAGOS_INTERVAL_MS = parseInt(process.env.REPLAY_PAGOS_INTERVAL_MS || '15000');

let _replayPagosEnCurso = false;
async function replayVerificacionesCobertura() {
  if (_replayPagosEnCurso) return;
  _replayPagosEnCurso = true;
  try {
    const pendientes = await repo.findPendientesVerificacion(RECOVERY_LIMIT_PAGOS);
    if (pendientes.length === 0) return;

    logger.info({ total: pendientes.length }, '[Pagos] Recovery replay: reverificando cobertura de pagos pendientes');

    for (const p of pendientes) {
      if (!p.idValidacionCobertura) continue; // defensivo — no debería ocurrir

      let cobertura;
      try {
        cobertura = await cob.obtenerCobertura(p.idValidacionCobertura);
      } catch (err) {
        logger.warn({ idPago: p.idPago, err: err.message }, '[Pagos] Recovery replay: Coberturas aún no disponible');
        if (cob.breaker?.opened) break; // el CB volvió a abrirse — no seguir el lote
        continue;
      }

      const conn = await connFn();
      await conn.beginTransaction();
      try {
        const affectedRows = await repo.marcarCoberturaVerificada(p.idPago, conn);
        // 0 filas = otro worker del clúster ya reconcilió esta fila primero.
        if (affectedRows > 0) {
          const coincide = cobertura !== null
            && cobertura.estadoCobertura === 'APROBADA'
            && cobertura.codigoAutorizacion === (p.codigoAutorizacionSeguro || null);

          if (coincide) {
            await outbox.publish(conn, 'PagoCoberturaVerificada', {
              idPago: p.idPago,
              idValidacionCobertura: p.idValidacionCobertura,
            }, null);
          } else {
            logger.error(
              { idPago: p.idPago, idValidacionCobertura: p.idValidacionCobertura, cobertura },
              '[Pagos] Cobertura NO coincide tras reconciliar — revisar manualmente, el pago NO se revierte automáticamente'
            );
            await outbox.publish(conn, 'PagoCoberturaInconsistente', {
              idPago: p.idPago,
              idValidacionCobertura: p.idValidacionCobertura,
              estadoCoberturaReal: cobertura?.estadoCobertura ?? 'NO_ENCONTRADA',
            }, null);
          }
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        logger.error({ err, idPago: p.idPago }, '[Pagos] Recovery replay: fallo al reconciliar — continúa con el siguiente');
      } finally {
        conn.release();
      }
    }
  } catch (err) {
    logger.error({ err }, '[Pagos] Error en recovery replay de verificación de cobertura');
  } finally {
    _replayPagosEnCurso = false;
  }
}

cob.registrarRecuperacion(replayVerificacionesCobertura);
const _replayPagosTimer = setInterval(replayVerificacionesCobertura, REPLAY_PAGOS_INTERVAL_MS);
_replayPagosTimer.unref(); // No mantiene vivo el proceso en tests/shutdown

const router = Router();

// ── Listado de pagos (admin/auditoría) — paginado ─────────────────────────────
router.get('/', verifyToken, requireRole('RECEPCIONISTA', 'Auditor'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const offset = (page - 1) * limit;
    const estado = req.query.estado;
    const q = req.query.q ? req.query.q.trim() : '';
    const idPaciente = req.query.idPaciente;
    const condiciones = [];
    const params = [];
    if (estado) { condiciones.push('pg.estado = ?'); params.push(estado); }
    // Búsqueda por texto libre solo sobre columnas propias de pagos. Para
    // "buscar por paciente" el frontend resuelve el nombre a un id exacto vía
    // el PatientPicker/endpoint de pacientes y lo manda como idPaciente.
    if (q) {
      condiciones.push('(pg.codigo_autorizacion LIKE ? OR pg.numero_comprobante LIKE ? OR pg.metodo_pago LIKE ? OR pg.tipo_comprobante LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (idPaciente) { condiciones.push('pg.id_paciente = ?'); params.push(idPaciente); }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM svc_pag.pagos pg ${where}`, params);
    const [rows] = await pool.query(
      `SELECT pg.id_pago, pg.id_cita, pg.id_paciente, pg.codigo_autorizacion, pg.metodo_pago,
              pg.monto_total, pg.monto_cobertura, pg.cobertura_verificada, pg.monto_copago,
              pg.estado, pg.tipo_comprobante, pg.numero_comprobante, pg.created_at,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_pag.pagos pg
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = pg.id_paciente
       ${where}
       ORDER BY pg.created_at DESC
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
 * /api/v2/pagos:
 *   post:
 *     summary: Confirmar un pago físico (efectivo/POS)
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idCita:
 *                 type: string
 *               idPaciente:
 *                 type: string
 *               idValidacionCobertura:
 *                 type: string
 *               montoTotal:
 *                 type: number
 *               montoCubiertoSeguro:
 *                 type: number
 *               montoCopago:
 *                 type: number
 *               metodoPago:
 *                 type: string
 *                 enum: [EFECTIVO, POS]
 *               tipoComprobante:
 *                 type: string
 *                 enum: [BOLETA, FACTURA]
 *     responses:
 *       201:
 *         description: Pago confirmado exitosamente
 *       400:
 *         description: Datos inválidos o error de dominio
 */
router.post('/',              verifyToken, requireRole('RECEPCIONISTA', 'Auditor'), requireIdempotencyKey, validate(confirmarPagoSchema), controller.confirmar);

/**
 * @swagger
 * /api/v2/pagos/{id}:
 *   get:
 *     summary: Consultar detalle de un pago por su ID
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del pago (ej. PAG-12345)
 *     responses:
 *       200:
 *         description: Detalle del pago
 *       404:
 *         description: Pago no encontrado
 */
router.get('/:id',            verifyToken, requireRole(['RECEPCIONISTA','INTERNAL','Auditor']), controller.consultar);

/**
 * @swagger
 * /api/v2/pagos/cita/{idCita}:
 *   get:
 *     summary: Consultar el pago asociado a una cita
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: idCita
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la cita
 *     responses:
 *       200:
 *         description: Detalle del pago
 *       404:
 *         description: Pago no encontrado
 */
router.get('/cita/:idCita',   verifyToken, requireRole(['RECEPCIONISTA','INTERNAL','Auditor']), controller.consultarPorCita);

/**
 * @swagger
 * /api/v2/pagos/{id}/reversar:
 *   post:
 *     summary: Reversar un pago confirmado
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del pago a reversar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motivo:
 *                 type: string
 *                 description: Razón de la reversión
 *     responses:
 *       200:
 *         description: Pago reversado exitosamente
 *       400:
 *         description: Error de dominio (ej. ya estaba reversado)
 *       404:
 *         description: Pago no encontrado
 */
router.post('/:id/reversar',  verifyToken, requireRole('RECEPCIONISTA', 'Auditor'),          controller.reversar);

module.exports = router;
