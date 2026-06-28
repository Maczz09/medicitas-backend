const cron = require('node-cron');
const db   = require('../src/config/database');
const NotificacionService = require('../src/modules/notificaciones/infrastructure/notificacion.service');

const sms = new NotificacionService();

function fmtHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function processRecordatorios30m() {
  const [citas] = await db.query(
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad,
            CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
            p.telefono AS paciente_telefono,
            CONCAT('Dr. ', m.nombre, ' ', m.apellido) AS medico_nombre
     FROM svc_cit.citas c
     LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
     LEFT JOIN svc_med.medicos m ON m.id_medico = c.id_medico
     WHERE c.estado = 'Pendiente'
       AND c.recordatorio_30m = 0
       AND c.fecha_hora BETWEEN DATE_ADD(NOW(), INTERVAL 28 MINUTE) AND DATE_ADD(NOW(), INTERVAL 32 MINUTE)`
  );

  for (const cita of citas) {
    try {
      await db.execute('UPDATE svc_cit.citas SET recordatorio_30m = 1 WHERE id = ?', [cita.id]);

      const hora  = fmtHora(cita.fecha_hora);
      const fecha = fmtFecha(cita.fecha_hora);
      const msg =
        `📅 Recordatorio Medicitas — Hola ${cita.paciente_nombre}, ` +
        `tienes una cita con ${cita.medico_nombre} (${cita.especialidad}) ` +
        `HOY ${fecha} a las ${hora}. ` +
        `Por favor llega con 10 minutos de anticipación y trae tu documento de identidad.`;

      await sms.enviarSMS(cita.paciente_telefono, msg);
      console.log(`[AlertasLlegada] Recordatorio 30min enviado — cita ${cita.id}`);
    } catch (err) {
      console.error(`[AlertasLlegada] Error recordatorio 30min cita ${cita.id}:`, err.message);
    }
  }
}

async function processAlertasYExpiracion() {
  const [citas] = await db.query(
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad, c.correlation_id,
            c.alerta_min0, c.alerta_min5, c.alerta_min10,
            CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
            p.telefono AS paciente_telefono,
            CONCAT('Dr. ', m.nombre, ' ', m.apellido) AS medico_nombre
     FROM svc_cit.citas c
     LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
     LEFT JOIN svc_med.medicos m ON m.id_medico = c.id_medico
     WHERE c.estado = 'Pendiente'
       AND c.fecha_hora <= NOW()`
  );

  for (const cita of citas) {
    const diffMin = Math.floor((Date.now() - new Date(cita.fecha_hora).getTime()) / 60000);
    const hora    = fmtHora(cita.fecha_hora);
    const fecha   = fmtFecha(cita.fecha_hora);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      if (diffMin >= 15) {
        await conn.execute("UPDATE svc_cit.citas SET estado = 'No_Asistida' WHERE id = ?", [cita.id]);
        await conn.commit();

        const msg =
          `⛔ Medicitas — ${cita.paciente_nombre}, tu cita con ${cita.medico_nombre} ` +
          `del ${fecha} a las ${hora} fue registrada como NO ASISTIDA ` +
          `al superar los 15 minutos de tolerancia. ` +
          `Contáctanos al +51 1 234-5678 para reprogramar.`;
        await sms.enviarSMS(cita.paciente_telefono, msg);
        console.log(`[AlertasLlegada] Cita ${cita.id} → No_Asistida`);

      } else if (diffMin >= 10 && !cita.alerta_min10) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min10 = 1 WHERE id = ?', [cita.id]);
        await conn.commit();

        const msg =
          `⚠️ Medicitas — ${cita.paciente_nombre}, ya van 10 minutos desde tu cita ` +
          `con ${cita.medico_nombre} (${hora}). ` +
          `Solo te quedan 5 minutos antes de que sea marcada como NO ASISTIDA. ` +
          `Por favor, preséntate de inmediato.`;
        await sms.enviarSMS(cita.paciente_telefono, msg);
        console.log(`[AlertasLlegada] Alerta min10 — cita ${cita.id}`);

      } else if (diffMin >= 5 && !cita.alerta_min5) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min5 = 1 WHERE id = ?', [cita.id]);
        await conn.commit();

        const msg =
          `⚠️ Medicitas — ${cita.paciente_nombre}, han pasado 5 minutos ` +
          `desde tu cita con ${cita.medico_nombre} (${hora}). ` +
          `Tienes 10 minutos más de tolerancia antes del cierre. ¡Date prisa!`;
        await sms.enviarSMS(cita.paciente_telefono, msg);
        console.log(`[AlertasLlegada] Alerta min5 — cita ${cita.id}`);

      } else if (diffMin >= 0 && !cita.alerta_min0) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min0 = 1 WHERE id = ?', [cita.id]);
        await conn.commit();

        const msg =
          `🔔 Medicitas — ${cita.paciente_nombre}, tu cita con ${cita.medico_nombre} ` +
          `(${cita.especialidad}) acaba de comenzar a las ${hora}. ` +
          `Dirígete a la recepción de inmediato. Tienes 15 minutos de tolerancia.`;
        await sms.enviarSMS(cita.paciente_telefono, msg);
        console.log(`[AlertasLlegada] Alerta min0 — cita ${cita.id}`);

      } else {
        await conn.commit();
      }
    } catch (err) {
      await conn.rollback();
      console.error(`[AlertasLlegada] Error cita ${cita.id}:`, err.message);
    } finally {
      conn.release();
    }
  }
}

cron.schedule('* * * * *', async () => {
  try {
    await Promise.all([
      processRecordatorios30m(),
      processAlertasYExpiracion(),
    ]);
  } catch (err) {
    console.error('[AlertasLlegada] Error general:', err.message);
  }
});

console.log('[Worker] Alertas Llegada cron iniciado (cada minuto).');
