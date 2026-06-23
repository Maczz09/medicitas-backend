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

async function processAlertasRetraso() {
  const conn = await db.getConnection();
  try {
    // Buscar citas que ya empezaron (o están a punto) y aún no han sido ingresadas (estado = Pendiente)
    const [citas] = await conn.query(
      `SELECT * FROM svc_cit.citas 
       WHERE estado = 'Pendiente' 
       AND fecha_hora <= NOW()`
    );

    for (const cita of citas) {
      // Calcular cuántos minutos han pasado desde la fecha_hora
      const minutosRetraso = Math.floor((new Date() - new Date(cita.fecha_hora)) / 60000);

      await conn.beginTransaction();

      if (minutosRetraso >= 15) {
        // Expirar la cita
        await conn.query(
          `UPDATE svc_cit.citas SET estado = 'No_Asistida' WHERE id = ?`,
          [cita.id]
        );
        const correlationId = uuidv4();
        await conn.query(
          `INSERT INTO svc_cit.outbox (id, evento, payload, correlation_id, publicado) VALUES (?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            'CitaExpirada',
            JSON.stringify({
              id_cita: cita.id,
              id_paciente: cita.id_paciente,
              motivo: 'Se canceló por inasistencia. Pasaron 15 minutos de tolerancia.'
            }),
            correlationId,
            0
          ]
        );
        console.log(`[AlertasLlegada] Cita ${cita.id} expirada por inasistencia (>15m).`);

      } else if (minutosRetraso >= 10 && cita.alerta_min10 === 0) {
        // Alerta min 10
        await conn.query(`UPDATE svc_cit.citas SET alerta_min10 = 1 WHERE id = ?`, [cita.id]);
        await enqueueAlerta(conn, cita, 10, 'Último aviso. Le quedan 5 minutos de tolerancia para presentarse a su cita.');
      } else if (minutosRetraso >= 5 && cita.alerta_min5 === 0) {
        // Alerta min 5
        await conn.query(`UPDATE svc_cit.citas SET alerta_min5 = 1 WHERE id = ?`, [cita.id]);
        await enqueueAlerta(conn, cita, 5, 'Su cita comenzó hace 5 minutos. Si no se presenta en 10 minutos, la cita se cancelará automáticamente.');
      } else if (minutosRetraso >= 0 && cita.alerta_min0 === 0) {
        // Alerta min 0
        await conn.query(`UPDATE svc_cit.citas SET alerta_min0 = 1 WHERE id = ?`, [cita.id]);
        await enqueueAlerta(conn, cita, 0, 'Su cita médica ha comenzado. Por favor, acérquese al consultorio.');
      }

      await conn.commit();
    }
  } catch (err) {
    console.error('[AlertasLlegada] Error en alertas de retraso:', err);
    if (conn) await conn.rollback();
  } finally {
    if (conn) conn.release();
  }
}

async function enqueueAlerta(conn, cita, minuto, mensaje) {
  const correlationId = uuidv4();
  await conn.query(
    `INSERT INTO svc_cit.outbox (id, evento, payload, correlation_id, publicado) VALUES (?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      'AlertaRetraso',
      JSON.stringify({
        id_cita: cita.id,
        id_paciente: cita.id_paciente,
        minutos_retraso: minuto,
        mensaje
      }),
      correlationId,
      0
    ]
  );
  console.log(`[AlertasLlegada] AlertaRetraso (min ${minuto}) enviada para cita ${cita.id}.`);
}

async function runAlertas() {
  await processRecordatorios30m();
  await processAlertasRetraso();
}

cron.schedule('* * * * *', () => {
  runAlertas().catch(console.error);
});

console.log('[Worker] Alertas Llegada cron iniciado (cada minuto).');
