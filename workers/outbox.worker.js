const cron = require('node-cron');
const db = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');

const SCHEMAS = ['svc_cit', 'svc_pac', 'svc_med', 'svc_pag', 'svc_hcl', 'svc_seg', 'svc_not', 'svc_aud', 'svc_pre', 'svc_fac'];

// El proyecto tiene DOS convenciones de columnas en las tablas outbox.
// Detectamos cuál usa cada esquema y construimos las consultas en consecuencia.
//   A: id / evento       / publicado (0|1)           / created_at
//   B: id_evento / tipo_evento / estado (PENDIENTE..) / creado_en
const CONV = {
  A: { id: 'id', evento: 'evento', pend: 'publicado = 0', marcar: 'publicado = 1', orden: 'created_at' },
  B: { id: 'id_evento', evento: 'tipo_evento', pend: "estado = 'PENDIENTE'", marcar: "estado = 'PUBLICADO', publicado_en = NOW()", orden: 'creado_en' },
};

const convCache = {};

async function detectarConvencion(conn, schema) {
  if (convCache[schema] !== undefined) return convCache[schema];
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'outbox'`,
    [schema],
  );
  const names = cols.map((c) => c.COLUMN_NAME);
  let conv = null;
  if (names.includes('publicado')) conv = CONV.A;
  else if (names.includes('estado')) conv = CONV.B;
  convCache[schema] = conv;
  return conv;
}

async function processOutbox() {
  for (const schema of SCHEMAS) {
    let conn;
    try {
      conn = await db.getConnection();
      const c = await detectarConvencion(conn, schema);
      if (!c) {
        conn.release();
        continue;
      }

      const [eventos] = await conn.query(
        `SELECT ${c.id} AS id, ${c.evento} AS evento, payload, correlation_id
         FROM ${schema}.outbox
         WHERE ${c.pend}
         ORDER BY ${c.orden} ASC
         LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );

      for (const evento of eventos) {
        try {
          await rabbitmq.publishEvent(evento.evento, evento.payload, evento.correlation_id, evento.id, schema);
          await conn.query(`UPDATE ${schema}.outbox SET ${c.marcar} WHERE ${c.id} = ?`, [evento.id]);
        } catch (pubErr) {
          console.error(`[Outbox] Error publicando evento ${evento.id} (${schema}):`, pubErr.message);
          await conn.query(`UPDATE ${schema}.outbox SET intentos = intentos + 1 WHERE ${c.id} = ?`, [evento.id]);
        }
      }
      conn.release();
    } catch (err) {
      if (conn) conn.release();
      if (err.code !== 'ER_NO_SUCH_TABLE') {
        console.error(`[Outbox] Error procesando schema ${schema}:`, err.message);
      }
    }
  }
}

// PM2 lanza este worker como proceso independiente (no pasa por workers/index.js),
// por lo que debe abrir su propia conexión/canal a RabbitMQ antes de publicar.
(async () => {
  try {
    if (!rabbitmq.getChannel()) {
      await rabbitmq.connect();
    }
  } catch (err) {
    console.error('[Outbox] No se pudo conectar a RabbitMQ al iniciar:', err.message);
  }

  cron.schedule('*/5 * * * * *', () => {
    processOutbox().catch(console.error);
  });

  console.log('[Worker] Outbox cron iniciado (cada 5 seg, ambas convenciones).');
})();
