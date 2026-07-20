const cron = require('node-cron');
const db = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');
const logger = require('../src/shared/logger/logger');

// svc_hor faltaba en esta lista: los eventos del módulo horarios
// (PlantillaHorarioActualizada, HorarioSemanaDefinido, BloqueoRegistrado) se
// escribían a svc_hor.outbox pero NADIE los publicaba — quedaban PENDIENTE para
// siempre y nunca llegaban a auditoría. Detectado durante la unificación (005).
const SCHEMAS = ['medicitas_users', 'svc_cit', 'svc_pac', 'svc_med', 'svc_pag', 'svc_hcl', 'svc_seg', 'svc_not', 'svc_aud', 'svc_pre', 'svc_fac', 'svc_hor'];

// Convención ÚNICA de tabla outbox (unificada por db/migrations/005):
//   id_evento / tipo_evento / payload / estado (PENDIENTE|PUBLICADO|FALLIDO) /
//   intentos / correlation_id / creado_en / publicado_en / error_msg
// Antes convivían dos convenciones y este worker las auto-detectaba por
// INFORMATION_SCHEMA — esa complejidad ya no es necesaria.
async function processOutbox() {
  for (const schema of SCHEMAS) {
    let conn;
    try {
      conn = await db.getConnection();

      const [eventos] = await conn.query(
        `SELECT id_evento AS id, tipo_evento AS evento, payload, correlation_id
         FROM ${schema}.outbox
         WHERE estado = 'PENDIENTE'
         ORDER BY creado_en ASC
         LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );

      for (const evento of eventos) {
        try {
          await rabbitmq.publishEvent(evento.evento, evento.payload, evento.correlation_id, evento.id, schema);
          await conn.query(
            `UPDATE ${schema}.outbox SET estado = 'PUBLICADO', publicado_en = NOW() WHERE id_evento = ?`,
            [evento.id],
          );
          // El correlationId es el MISMO del request HTTP que originó el evento:
          // permite saltar en Loki del `POST /api/v2/citas` a su publicación
          // asíncrona con una sola query, sin depender del sampling de OTel.
          logger.info(
            { schema, idEvento: evento.id, tipoEvento: evento.evento, correlationId: evento.correlation_id },
            `[Outbox] Evento publicado: ${evento.evento} (${schema})`,
          );
        } catch (pubErr) {
          logger.error(
            { schema, idEvento: evento.id, tipoEvento: evento.evento, correlationId: evento.correlation_id, err: pubErr.message },
            `[Outbox] Error publicando evento ${evento.id} (${schema}): ${pubErr.message}`,
          );
          await conn.query(
            `UPDATE ${schema}.outbox SET intentos = intentos + 1, error_msg = ? WHERE id_evento = ?`,
            [String(pubErr.message).slice(0, 1000), evento.id],
          );
        }
      }
      conn.release();
    } catch (err) {
      if (conn) conn.release();
      if (err.code !== 'ER_NO_SUCH_TABLE') {
        logger.error(
          { schema, err: err.message, codigo: err.code },
          `[Outbox] Error procesando schema ${schema}: ${err.message}`,
        );
      }
    }
  }
}

async function conectarConReintentos(maxIntentos = 10, delayMs = 3000) {
  for (let i = 1; i <= maxIntentos; i++) {
    try {
      await rabbitmq.connect();
      logger.info('[Outbox] RabbitMQ conectado exitosamente.');
      return;
    } catch (err) {
      logger.warn(
        { intento: i, maxIntentos, err: err.message },
        `[Outbox] Intento ${i}/${maxIntentos} fallido: ${err.message}`,
      );
      if (i < maxIntentos) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  logger.error('[Outbox] No se pudo conectar a RabbitMQ tras todos los intentos. El cron publicará con reintentos automáticos.');
}

// PM2 lanza este worker como proceso independiente (no pasa por workers/index.js),
// por lo que debe abrir su propia conexión/canal a RabbitMQ antes de publicar.
(async () => {
  if (!rabbitmq.getChannel()) {
    await conectarConReintentos();
  }

  cron.schedule('*/5 * * * * *', async () => {
    // Si el canal se perdió (reconexión tras caída), intentar reconectar antes de publicar
    if (!rabbitmq.getChannel()) {
      logger.warn('[Outbox] Canal perdido — intentando reconectar...');
      await conectarConReintentos(3, 1000);
    }
    processOutbox().catch((err) => logger.error({ err: err.message }, `[Outbox] Error no controlado: ${err.message}`));
  });

  logger.info('[Worker] Outbox cron iniciado (cada 5 seg, convención unificada).');
})();
