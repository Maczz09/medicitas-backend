const cron = require('node-cron');
const db = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');

async function processOutbox() {
  const schemas = ['svc_cit', 'svc_pac', 'svc_med', 'svc_pag', 'svc_hcl', 'svc_seg', 'svc_not', 'svc_aud', 'svc_pre'];

  for (const schema of schemas) {
    try {
      const conn = await db.getConnection();
      
      const [eventos] = await conn.query(
        `SELECT * FROM ${schema}.outbox 
         WHERE estado = 'PENDIENTE' 
         ORDER BY creado_en ASC LIMIT 50 FOR UPDATE SKIP LOCKED`
      );

      for (const evento of eventos) {
        try {
          await rabbitmq.publishEvent(evento.tipo_evento, evento.payload, evento.correlation_id);
          
          await conn.query(
            `UPDATE ${schema}.outbox 
             SET estado = 'PUBLICADO', publicado_en = NOW() 
             WHERE id_evento = ?`,
            [evento.id_evento]
          );
        } catch (pubErr) {
          console.error(`[Outbox] Error publicando evento ${evento.id_evento}:`, pubErr);
          await conn.query(
            `UPDATE ${schema}.outbox 
             SET intentos = intentos + 1, error_msg = ? 
             ${evento.intentos >= 3 ? ", estado = 'FALLIDO'" : ""} 
             WHERE id_evento = ?`,
            [pubErr.message, evento.id_evento]
          );
        }
      }
      conn.release();
    } catch (err) {
      console.error(`[Outbox] Error procesando schema ${schema}:`, err);
    }
  }
}

cron.schedule('*/5 * * * * *', () => {
  processOutbox().catch(console.error);
});

console.log('[Worker] Outbox cron iniciado (cada 5 seg).');
