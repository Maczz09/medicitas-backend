const cron = require('node-cron');
const db   = require('../src/config/database');
const crypto = require('crypto');
const { client: redisClient } = require('../src/config/redis');
const { DisponibilidadRedisCache } = require('../src/modules/citas/adapters/out/cache/DisponibilidadRedisCache');
const logger = require('../src/shared/logger/logger');

// Este proceso (PM2 worker-alertas-llegada) no conectaba Redis. Se conecta de
// forma perezosa y defensiva para poder liberar el slot de agenda cuando una
// cita expira a No_Asistida — misma compensación que hace CancelarCitaUseCase.
// Si Redis no está disponible, el TTL de la caché (~5 min) + el constraint
// UNIQUE en BD son la red de seguridad final, así que no se bloquea el cron.
let _cacheDisponibilidad = null;
async function getCacheDisponibilidad() {
  if (_cacheDisponibilidad) return _cacheDisponibilidad;
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    _cacheDisponibilidad = new DisponibilidadRedisCache(null);
    return _cacheDisponibilidad;
  } catch (err) {
    logger.warn({ err: err.message }, `[AlertasLlegada] Redis no disponible para liberar slot: ${err.message}`);
    return null;
  }
}

function fmtHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

async function publicarEvento(conn, tipoEvento, idCita, payload) {
  const idEvento = crypto.randomUUID();
  const correlationId = crypto.randomUUID(); // Simplificado para cron
  
  await conn.execute(
    `INSERT INTO svc_cit.outbox (id_evento, tipo_evento, payload, correlation_id)
     VALUES (?, ?, ?, ?)`,
    [idEvento, tipoEvento, JSON.stringify(payload), correlationId]
  );
}

async function processRecordatorios30m() {
  const now = new Date();
  const startTarget = new Date(now.getTime() + 28 * 60000);
  const endTarget   = new Date(now.getTime() + 32 * 60000);

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
       AND c.fecha_hora BETWEEN ? AND ?`,
    [now, endTarget]
  );

  for (const cita of citas) {
    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      await conn.execute('UPDATE svc_cit.citas SET recordatorio_30m = 1 WHERE id = ?', [cita.id]);

      await publicarEvento(conn, 'Recordatorio30m', cita.id, {
        idCita: cita.id,
        idPaciente: cita.id_paciente,
        pacienteTelefono: cita.paciente_telefono,
        pacienteNombre: cita.paciente_nombre,
        medicoNombre: cita.medico_nombre,
        especialidad: cita.especialidad,
        fechaHora: cita.fecha_hora
      });

      await conn.commit();
      logger.info({ idCita: cita.id, idPaciente: cita.id_paciente }, `[AlertasLlegada] Recordatorio 30min encolado — cita ${cita.id}`);
    } catch (err) {
      await conn.rollback();
      logger.error({ idCita: cita.id, err: err.message }, `[AlertasLlegada] Error recordatorio 30min cita ${cita.id}: ${err.message}`);
    } finally {
      conn.release();
    }
  }
}

// Dos ventanas de tolerancia, no una sola:
//   - Reserva ANTICIPADA (agendada con tiempo de sobra antes de la hora):
//     15 min desde fecha_hora — el paciente tuvo aviso previo.
//   - Reserva "EN LA HORA" (walk-in: el registro se creó casi al mismo
//     tiempo que su propia fecha_hora): 20 min — el trámite de agendar +
//     validar cobertura + cobrar + dar ingreso consume del mismo margen que
//     la tolerancia, así que necesita más aire. Coincide con el criterio que
//     ya usa el selector de turnos del frontend (SlotPicker: duracion-10min
//     = 20 min para turnos de 30 min) para considerar un turno "aún vigente".
// Se detecta comparando created_at contra fecha_hora — pero de forma
// ASIMÉTRICA, no con una ventana simétrica de ±5 min: el SlotPicker del
// frontend deja elegir un turno hasta LIMITE_INMEDIATA_MIN después de su
// hora nominal (es "walk-in" tardío, no anticipado), así que registrar el
// ingreso hasta ese mismo margen tarde debe seguir contando como "en la
// hora". Antes se usaba ±5 min simétrico: una reserva creada, por ejemplo,
// 18 min después de su fecha_hora (perfectamente elegible en el SlotPicker)
// caía fuera de esa ventana y se clasificaba como ANTICIPADA — aplicándole
// 15 min de tolerancia sobre una fecha_hora que ya tenía 18 min de retraso,
// es decir, nacía prácticamente ya vencida.
const LIMITE_ANTICIPADA_MIN = 15;
const LIMITE_INMEDIATA_MIN = 20;
const MARGEN_FUTURO_INMEDIATA_MIN = 5;

async function processAlertasYExpiracion() {
  const now = new Date();

  const [citas] = await db.query(
    `SELECT c.id, c.id_paciente, c.id_medico, c.fecha_hora, c.especialidad, c.correlation_id,
            c.created_at, c.alerta_min0, c.alerta_min5, c.alerta_min10,
            CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
            p.telefono AS paciente_telefono,
            CONCAT('Dr. ', m.nombre, ' ', m.apellido) AS medico_nombre
     FROM svc_cit.citas c
     LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
     LEFT JOIN svc_med.medicos m ON m.id_medico = c.id_medico
     WHERE c.estado = 'Pendiente'
       AND c.fecha_hora <= ?`,
    [now]
  );

  for (const cita of citas) {
    const fechaCita = new Date(cita.fecha_hora);
    const creada    = new Date(cita.created_at);
    const diffMin   = Math.floor((Date.now() - fechaCita.getTime()) / 60000);
    const hora      = fmtHora(cita.fecha_hora);

    // Positivo cuando se creó DESPUÉS de su propia fecha_hora (walk-in tardío).
    const minCreadaTrasFechaCita = (creada.getTime() - fechaCita.getTime()) / 60000;
    const esReservaInmediata =
      minCreadaTrasFechaCita <= LIMITE_INMEDIATA_MIN &&
      minCreadaTrasFechaCita >= -MARGEN_FUTURO_INMEDIATA_MIN;
    const limite = esReservaInmediata ? LIMITE_INMEDIATA_MIN : LIMITE_ANTICIPADA_MIN;
    const checkpointTemprano = Math.round(limite / 3);
    const checkpointTardio   = Math.round((limite * 2) / 3);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      if (diffMin >= limite) {
        await conn.execute("UPDATE svc_cit.citas SET estado = 'No_Asistida' WHERE id = ?", [cita.id]);

        await publicarEvento(conn, 'CitaExpirada', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          fechaHoraCita: cita.fecha_hora,
          minutosEsperados: limite,
        });

        await conn.commit();
        logger.info(
          { idCita: cita.id, idPaciente: cita.id_paciente, limite, tipoReserva: esReservaInmediata ? 'inmediata' : 'anticipada', correlationId: cita.correlation_id },
          `[AlertasLlegada] Cita ${cita.id} → No_Asistida (límite ${limite}min, ${esReservaInmediata ? 'inmediata' : 'anticipada'})`,
        );

        // Compensación: liberar el slot de la agenda del médico (idempotente).
        try {
          const cache = await getCacheDisponibilidad();
          if (cache) await cache.liberarSlot(cita.id_medico, new Date(cita.fecha_hora));
        } catch (err) {
          logger.warn({ idCita: cita.id, err: err.message }, `[AlertasLlegada] No se pudo liberar slot de cita ${cita.id}: ${err.message}`);
        }

      } else if (diffMin >= checkpointTardio && !cita.alerta_min10) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min10 = 1 WHERE id = ?', [cita.id]);

        await publicarEvento(conn, 'AlertaRetraso', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          minutoAlerta: diffMin,
          minutosRestantes: limite - diffMin,
          pacienteNombre: cita.paciente_nombre,
          medicoNombre: cita.medico_nombre,
          hora
        });

        await conn.commit();
        logger.info(
          { idCita: cita.id, diffMin, minutosRestantes: limite - diffMin, checkpoint: 'tardio', correlationId: cita.correlation_id },
          `[AlertasLlegada] Alerta tardía (${diffMin}min, quedan ${limite - diffMin}) — cita ${cita.id}`,
        );

      } else if (diffMin >= checkpointTemprano && !cita.alerta_min5) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min5 = 1 WHERE id = ?', [cita.id]);

        await publicarEvento(conn, 'AlertaRetraso', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          minutoAlerta: diffMin,
          minutosRestantes: limite - diffMin,
          pacienteNombre: cita.paciente_nombre,
          medicoNombre: cita.medico_nombre,
          hora
        });

        await conn.commit();
        logger.info(
          { idCita: cita.id, diffMin, minutosRestantes: limite - diffMin, checkpoint: 'temprano', correlationId: cita.correlation_id },
          `[AlertasLlegada] Alerta temprana (${diffMin}min, quedan ${limite - diffMin}) — cita ${cita.id}`,
        );

      } else if (diffMin >= 0 && !cita.alerta_min0) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min0 = 1 WHERE id = ?', [cita.id]);

        await publicarEvento(conn, 'AlertaRetraso', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          minutoAlerta: 0,
          minutosRestantes: limite,
          pacienteNombre: cita.paciente_nombre,
          medicoNombre: cita.medico_nombre,
          hora
        });

        await conn.commit();
        logger.info(
          { idCita: cita.id, diffMin: 0, minutosRestantes: limite, checkpoint: 'min0', correlationId: cita.correlation_id },
          `[AlertasLlegada] Alerta min0 (tolerancia ${limite}min) — cita ${cita.id}`,
        );

      } else {
        await conn.commit();
      }
    } catch (err) {
      await conn.rollback();
      logger.error({ idCita: cita.id, err: err.message, correlationId: cita.correlation_id }, `[AlertasLlegada] Error cita ${cita.id}: ${err.message}`);
    } finally {
      conn.release();
    }
  }
}

async function runCrons() {
  try {
    await Promise.all([
      processRecordatorios30m(),
      processAlertasYExpiracion(),
    ]);
  } catch (err) {
    logger.error({ err: err.message }, `[AlertasLlegada] Error general: ${err.message}`);
  }
}

// Ejecutar inmediatamente y luego cada minuto (60000ms)
runCrons();
setInterval(runCrons, 60000);

logger.info('[Worker] Alertas Llegada cron iniciado (cada minuto, enviando a Outbox).');
