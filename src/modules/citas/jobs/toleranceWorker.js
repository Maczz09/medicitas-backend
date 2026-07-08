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
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.correlation_id, c.created_at,
            c.especialidad, c.recordatorio_30m, c.alerta_min0, c.alerta_min5, c.alerta_min10,
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
// Dos ventanas distintas, no una sola:
//   - Reserva ANTICIPADA (agendada con tiempo de sobra antes de la hora):
//     15 min de tolerancia desde fecha_hora — el paciente tuvo aviso previo,
//     debe llegar cerca de su horario.
//   - Reserva "EN LA HORA" (walk-in: se creó casi al mismo tiempo que la
//     propia fecha_hora): 20 min — el trámite de agendar + validar cobertura
//     + cobrar + dar ingreso consume del mismo margen que la tolerancia,
//     así que necesita más aire. Coincide con el criterio ya usado por el
//     selector de turnos del frontend (SlotPicker: duracion_cita_min - 10 =
//     20 min para slots de 30 min) para considerar un turno "aún vigente".
// Se detecta comparando created_at contra fecha_hora — de forma ASIMÉTRICA,
// no con una ventana simétrica de ±5 min: el SlotPicker del frontend deja
// elegir un turno hasta LIMITE_INMEDIATA_MIN después de su hora nominal, así
// que registrar hasta ese mismo margen tarde debe seguir contando como "en
// la hora". Con ±5 min simétrico, una reserva creada 18 min después de su
// fecha_hora (elegible en el SlotPicker) caía como ANTICIPADA — 15 min de
// tolerancia sobre una fecha_hora ya con 18 min de retraso: nacía ya vencida.
const LIMITE_ANTICIPADA_MIN = 15;
const LIMITE_INMEDIATA_MIN = 20;
const MARGEN_FUTURO_INMEDIATA_MIN = 5;

async function procesarTolerancia() {
  const citas = await getCitasPendientesAtrasadas();

  for (const row of citas) {
    const ahora     = new Date();
    const fechaCita = new Date(row.fecha_hora);
    const creada    = new Date(row.created_at);
    const diffMin   = Math.floor((ahora - fechaCita) / 60000);

    // Positivo cuando se creó DESPUÉS de su propia fecha_hora (walk-in tardío).
    const minCreadaTrasFechaCita = (creada.getTime() - fechaCita.getTime()) / 60000;
    const esReservaInmediata =
      minCreadaTrasFechaCita <= LIMITE_INMEDIATA_MIN &&
      minCreadaTrasFechaCita >= -MARGEN_FUTURO_INMEDIATA_MIN;
    const limite = esReservaInmediata ? LIMITE_INMEDIATA_MIN : LIMITE_ANTICIPADA_MIN;
    // Mismos tercios de siempre (antes 5/10/15 sobre ventana de 15), solo
    // que ahora escalados a la ventana que corresponda (15 o 20).
    const checkpointTemprano = Math.round(limite / 3);
    const checkpointTardio   = Math.round((limite * 2) / 3);

    const hora  = fmtHora(row.fecha_hora);
    const fecha = fmtFecha(row.fecha_hora);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      if (diffMin >= limite) {
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
          minutosEsperados: limite,
        }, row.correlation_id);
        await conn.commit();

        const msg =
          `⛔ Medicitas — ${row.paciente_nombre}, tu cita con ${row.medico_nombre} ` +
          `del ${fecha} a las ${hora} fue registrada como NO ASISTIDA ` +
          `al superar los ${limite} minutos de tolerancia. ` +
          `Contáctanos al +51 1 234-5678 para reprogramar.`;
        await sms.enviarSMS(row.paciente_telefono, msg);
        logger.info({ idCita: row.id, limite, esReservaInmediata }, '[Tolerance] Cita expirada → No_Asistida');

      } else {
        let flagCol    = null;
        let flagVal    = row.alerta_min0;
        let msgTexto   = null;

        if (diffMin >= checkpointTardio && !row.alerta_min10) {
          flagCol  = 'alerta_min10';
          flagVal  = true;
          msgTexto =
            `⚠️ Medicitas — ${row.paciente_nombre}, ya van ${diffMin} minutos desde tu cita ` +
            `con ${row.medico_nombre} (${hora}). ` +
            `Solo te quedan ${limite - diffMin} minutos antes de que sea marcada como NO ASISTIDA. ` +
            `Por favor, preséntate de inmediato.`;

        } else if (diffMin >= checkpointTemprano && !row.alerta_min5) {
          flagCol  = 'alerta_min5';
          flagVal  = true;
          msgTexto =
            `⚠️ Medicitas — ${row.paciente_nombre}, han pasado ${diffMin} minutos ` +
            `desde tu cita con ${row.medico_nombre} (${hora}). ` +
            `Tienes ${limite - diffMin} minutos más de tolerancia antes del cierre. ¡Date prisa!`;

        } else if (diffMin >= 0 && !row.alerta_min0) {
          flagCol  = 'alerta_min0';
          flagVal  = true;
          msgTexto =
            `🔔 Medicitas — ${row.paciente_nombre}, tu cita con ${row.medico_nombre} ` +
            `(${row.especialidad}) acaba de comenzar a las ${hora}. ` +
            `Dirígete a la recepción de inmediato. Tienes ${limite} minutos de tolerancia.`;
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
