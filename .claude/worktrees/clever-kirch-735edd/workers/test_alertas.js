const cron = require('node-cron');
const db = require('../src/config/database');
const { v4: uuidv4 } = require('uuid');

async function processRecordatorios30m() {
  const conn = await db.getConnection();
  try {
    const [citas] = await conn.query(
      `SELECT * FROM svc_cit.citas 
       WHERE estado = 'Pendiente' 
       AND recordatorio_30m = 0 
       AND fecha_hora > NOW() 
       AND fecha_hora <= DATE_ADD(NOW(), INTERVAL 30 MINUTE)`
    );

    for (const cita of citas) {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE svc_cit.citas SET recordatorio_30m = 1 WHERE id = ?`,
        [cita.id]
      );

      const correlationId = uuidv4();
      await conn.query(
        `INSERT INTO svc_cit.outbox (id, evento, payload, correlation_id, publicado) VALUES (?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          'RecordatorioCita',
          JSON.stringify({
            id_cita: cita.id,
            id_paciente: cita.id_paciente,
            fecha_hora: cita.fecha_hora,
            mensaje: 'Su cita médica comienza en 30 minutos. Por favor acérquese a recepción.'
          }),
          correlationId,
          0
        ]
      );

      await conn.commit();
      console.log(`[AlertasLlegada] Recordatorio 30m enviado para cita ${cita.id}.`);
    }
  } catch (err) {
    console.error('[AlertasLlegada] Error en recordatorios 30m:', err);
    if (conn) await conn.rollback();
  } finally {
    if (conn) conn.release();
  }
}

async function run() {
  await processRecordatorios30m();
  process.exit(0);
}
run();
