const cron = require('node-cron');
const pool = require('../../../../config/database');
const { CitasMySQLRepository } = require('../adapters/out/repositories/CitasMySQLRepository');
const { OutboxMySQLPublisher } = require('../adapters/out/events/OutboxMySQLPublisher');
const NotificacionService = require('../../../notificaciones/infrastructure/notificacion.service');
const logger = require('../../../../shared/logger/logger');

const citasRepo = new CitasMySQLRepository();
const eventPublisher = new OutboxMySQLPublisher();
const sms = new NotificacionService();

function fmtHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function getCitaConDatos(idCita) {
  const [rows] = await pool.query(
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad,
            c.recordatorio_30m, c.alerta_min0, c.alerta_min5, c.alerta_min10,
            CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
            p.telefono AS paciente_telefono,
            CONCAT('Dr. ', m.nombre, ' ', m.apellido) AS medico_nombre
     FROM svc_cit.citas c
     LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
     LEFT JOIN svc_med.medicos m ON m.id_medico = c.id_medico
     WHERE c.id = ?`,
    [idCita]
  );
  return rows[0] || null;
}

async function getProximasCitas30Min() {
  const [rows] = await pool.query(
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad, c.correlation_id,
            c.recordatorio_30m, c.alerta_min0, c.alerta_min5, c.alerta_min10,
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
  return rows;
}

async function getCitasPendientesAtrasadas() {
  const [rows] = await pool.query(
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad, c.correlation_id,
            c.recordatorio_30m, c.alerta_min0, c.alerta_min5, c.alerta_min10,
            CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
            p.telefono AS paciente_telefono,
            CONCAT('Dr. ', m.nombre, ' ', m.apellido) AS medico_nombre
     FROM svc_cit.citas c
     LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
     LEFT JOIN svc_med.medicos m ON m.id_medico = c.id_medico
     WHERE c.estado = 'Pendiente'
       AND c.fecha_hora <= NOW()`
  );
  return rows;
}

// ── 30-min reminder ─────────────────────────────────────────────────────────
async function procesarRecordatorios30min() {
  const citas = await getProximasCitas30Min();
  for (const row of citas) {
    try {
      await pool.execute(
        'UPDATE svc_cit.citas SET recordatorio_30m = 1 WHERE id = ?',
        [row.id]
      );

      const hora   = fmtHora(row.fecha_hora);
      const fecha  = fmtFecha(row.fecha_hora);
      const msg =
        `📅 Recordatorio Medicitas — Hola ${row.paciente_nombre}, ` +
        `tienes una cita con ${row.medico_nombre} (${row.especialidad}) ` +
        `HOY ${fecha} a las ${hora}. ` +
        `Por favor llega con 10 minutos de anticipación y trae tu documento de identidad.`;

      await sms.enviarSMS(row.paciente_telefono, msg);
      logger.info({ idCita: row.id }, '[Tolerance] Recordatorio 30min enviado');
    } catch (err) {
      logger.error({ idCita: row.id, err: err.message }, '[Tolerance] Error recordatorio 30min');
    }
  }
}

// ── Alertas de tolerancia y expiración ──────────────────────────────────────
async function procesarTolerancia() {
  const citas = await getCitasPendientesAtrasadas();

  for (const row of citas) {
    const ahora   = new Date();
    const diffMs  = ahora - new Date(row.fecha_hora);
    const diffMin = Math.floor(diffMs / 60000);

    const hora  = fmtHora(row.fecha_hora);
    const fecha = fmtFecha(row.fecha_hora);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      if (diffMin >= 15) {
        // Expire → No_Asistida
        await conn.execute(
          "UPDATE svc_cit.citas SET estado = 'No_Asistida' WHERE id = ?",
          [row.id]
        );
        await eventPublisher.publish(conn, 'CitaExpirada', {
          idCita:       row.id,
          idPaciente:   row.id_paciente,
          idMedico:     row.id_medico,
          fechaHoraCita: new Date(row.fecha_hora).toISOString(),
          minutosEsperados: 15,
        }, row.correlation_id);
        await conn.commit();

        const msg =
          `⛔ Medicitas — ${row.paciente_nombre}, tu cita con ${row.medico_nombre} ` +
          `del ${fecha} a las ${hora} fue registrada como NO ASISTIDA ` +
          `al superar los 15 minutos de tolerancia. ` +
          `Contáctanos al +51 1 234-5678 para reprogramar.`;
        await sms.enviarSMS(row.paciente_telefono, msg);
        logger.info({ idCita: row.id }, '[Tolerance] Cita expirada → No_Asistida');

      } else {
        let flagCol    = null;
        let flagVal    = row.alerta_min0;
        let msgTexto   = null;

        if (diffMin >= 10 && !row.alerta_min10) {
          flagCol  = 'alerta_min10';
          flagVal  = true;
          msgTexto =
            `⚠️ Medicitas — ${row.paciente_nombre}, ya van 10 minutos desde tu cita ` +
            `con ${row.medico_nombre} (${hora}). ` +
            `Solo te quedan 5 minutos antes de que sea marcada como NO ASISTIDA. ` +
            `Por favor, preséntate de inmediato.`;

        } else if (diffMin >= 5 && !row.alerta_min5) {
          flagCol  = 'alerta_min5';
          flagVal  = true;
          msgTexto =
            `⚠️ Medicitas — ${row.paciente_nombre}, han pasado 5 minutos ` +
            `desde tu cita con ${row.medico_nombre} (${hora}). ` +
            `Tienes 10 minutos más de tolerancia antes del cierre. ¡Date prisa!`;

        } else if (diffMin >= 0 && !row.alerta_min0) {
          flagCol  = 'alerta_min0';
          flagVal  = true;
          msgTexto =
            `🔔 Medicitas — ${row.paciente_nombre}, tu cita con ${row.medico_nombre} ` +
            `(${row.especialidad}) acaba de comenzar a las ${hora}. ` +
            `Dirígete a la recepción de inmediato. Tienes 15 minutos de tolerancia.`;
        }

        if (flagCol) {
          await conn.execute(
            `UPDATE svc_cit.citas SET ${flagCol} = 1 WHERE id = ?`,
            [row.id]
          );
          await conn.commit();
          await sms.enviarSMS(row.paciente_telefono, msgTexto);
          logger.info({ idCita: row.id, flagCol }, '[Tolerance] Alerta enviada');
        } else {
          await conn.commit();
        }
      }
    } catch (err) {
      await conn.rollback();
      logger.error({ idCita: row.id, err: err.message }, '[Tolerance] Error procesando cita');
    } finally {
      conn.release();
    }
  }
}

// ── Cron: cada minuto ────────────────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  try {
    await Promise.all([
      procesarRecordatorios30min(),
      procesarTolerancia(),
    ]);
  } catch (err) {
    logger.error({ err: err.message }, '[ToleranceWorker] Error general');
  }
});

logger.info('[ToleranceWorker] Iniciado — recordatorio 30min + tolerancia activa.');
