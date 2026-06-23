const cron = require('node-cron');
const db = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');

async function processOutbox() {
  const schemas = ['svc_cit', 'svc_pac', 'svc_med', 'svc_pag', 'svc_hcl', 'svc_seg', 'svc_not', 'svc_aud', 'svc_pre', 'svc_fac'];

  for (const schema of schemas) {
    try {
      const conn = await db.getConnection();
      
      const [eventos] = await conn.query(
        `SELECT * FROM ${schema}.outbox 
         WHERE publicado = 0 
         ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED`
      );

      for (const evento of eventos) {
        try {
          await rabbitmq.publishEvent(evento.evento, evento.payload, evento.correlation_id);
          
          await conn.query(
            `UPDATE ${schema}.outbox 
             SET publicado = 1 
             WHERE id = ?`,
            [evento.id]
          );
        } catch (pubErr) {
          console.error(`[Outbox] Error publicando evento ${evento.id}:`, pubErr);
          await conn.query(
            `UPDATE ${schema}.outbox 
             SET intentos = intentos + 1
             WHERE id = ?`,
            [evento.id]
          );
        }
      }
      conn.release();
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') {
        console.error(`[Outbox] Error procesando schema ${schema}:`, err.message);
      }
    }
  }
}

cron.schedule('*/5 * * * * *', () => {
  processOutbox().catch(console.error);
});

console.log('[Worker] Outbox cron iniciado (cada 5 seg).');
