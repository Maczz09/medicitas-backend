const cron = require('node-cron');
const db = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

async function checkTolerancia() {
  const conn = await db.getConnection();
  try {
    const [citas] = await conn.query(
      `SELECT * FROM svc_cit.citas 
       WHERE estado = 'Pendiente' 
       AND created_at < NOW() - INTERVAL 15 MINUTE`
    );

    for (const cita of citas) {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE svc_cit.citas SET estado = 'Cancelada', motivo_cancelacion = 'TIEMPO_DE_TOLERANCIA_EXCEDIDO' WHERE id_cita = ?`,
        [cita.id_cita]
      );

      const correlationId = uuidv4();
      
      await conn.query(
        `INSERT INTO svc_cit.outbox (id_evento, tipo_evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
        [
          uuidv4(),
          'CitaCanceladaPorTolerancia',
          JSON.stringify({
            id_cita: cita.id_cita,
            id_paciente: cita.id_paciente,
            motivo: 'Se agotaron los 15 minutos de reserva sin confirmar pago.'
          }),
          correlationId
        ]
      );

      await conn.commit();
      console.log(`[Tolerancia] Cita ${cita.id_cita} cancelada automáticamente.`);
    }
  } catch (err) {
    console.error('[Tolerancia] Error en cron:', err);
    if (conn) await conn.rollback();
  } finally {
    if (conn) conn.release();
  }
}

cron.schedule('* * * * *', () => {
  checkTolerancia().catch(console.error);
});

console.log('[Worker] Tolerancia cron iniciado (cada minuto).');
