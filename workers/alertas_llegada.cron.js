const cron = require('node-cron');
const db   = require('../src/config/database');
const crypto = require('crypto');
const { client: redisClient } = require('../src/config/redis');
const { DisponibilidadRedisCache } = require('../src/modules/citas/adapters/out/cache/DisponibilidadRedisCache');

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
    console.warn('[AlertasLlegada] Redis no disponible para liberar slot:', err.message);
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
    `INSERT INTO svc_cit.outbox (id, evento, payload, correlation_id)
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
      console.log(`[AlertasLlegada] Recordatorio 30min encolado — cita ${cita.id}`);
    } catch (err) {
      await conn.rollback();
      console.error(`[AlertasLlegada] Error recordatorio 30min cita ${cita.id}:`, err.message);
    } finally {
      conn.release();
    }
  }
}

async function processAlertasYExpiracion() {
  const now = new Date();
  
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
       AND c.fecha_hora <= ?`,
    [now]
  );

  for (const cita of citas) {
    const diffMin = Math.floor((Date.now() - new Date(cita.fecha_hora).getTime()) / 60000);
    const hora    = fmtHora(cita.fecha_hora);
    console.log(`[DEBUG] Cita ${cita.id} | fecha_hora: ${cita.fecha_hora} | diffMin: ${diffMin} | Date.now(): ${new Date()} | parsed: ${new Date(cita.fecha_hora)}`);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      if (diffMin >= 15) {
        await conn.execute("UPDATE svc_cit.citas SET estado = 'No_Asistida' WHERE id = ?", [cita.id]);
        
        await publicarEvento(conn, 'CitaExpirada', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          fechaHoraCita: cita.fecha_hora
        });
        
        await conn.commit();
        console.log(`[AlertasLlegada] Cita ${cita.id} → No_Asistida`);

        // Compensación: liberar el slot de la agenda del médico (idempotente).
        try {
          const cache = await getCacheDisponibilidad();
          if (cache) await cache.liberarSlot(cita.id_medico, new Date(cita.fecha_hora));
        } catch (err) {
          console.warn(`[AlertasLlegada] No se pudo liberar slot de cita ${cita.id}:`, err.message);
        }

      } else if (diffMin >= 10 && !cita.alerta_min10) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min10 = 1 WHERE id = ?', [cita.id]);
        
        await publicarEvento(conn, 'AlertaRetraso', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          minutoAlerta: 10,
          pacienteNombre: cita.paciente_nombre,
          medicoNombre: cita.medico_nombre,
          hora
        });

        await conn.commit();
        console.log(`[AlertasLlegada] Alerta min10 — cita ${cita.id}`);

      } else if (diffMin >= 5 && !cita.alerta_min5) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min5 = 1 WHERE id = ?', [cita.id]);
        
        await publicarEvento(conn, 'AlertaRetraso', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          minutoAlerta: 5,
          pacienteNombre: cita.paciente_nombre,
          medicoNombre: cita.medico_nombre,
          hora
        });

        await conn.commit();
        console.log(`[AlertasLlegada] Alerta min5 — cita ${cita.id}`);

      } else if (diffMin >= 0 && !cita.alerta_min0) {
        await conn.execute('UPDATE svc_cit.citas SET alerta_min0 = 1 WHERE id = ?', [cita.id]);
        
        await publicarEvento(conn, 'AlertaRetraso', cita.id, {
          idCita: cita.id,
          idPaciente: cita.id_paciente,
          pacienteTelefono: cita.paciente_telefono,
          minutoAlerta: 0,
          pacienteNombre: cita.paciente_nombre,
          medicoNombre: cita.medico_nombre,
          hora
        });

        await conn.commit();
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

async function runCrons() {
  try {
    await Promise.all([
      processRecordatorios30m(),
      processAlertasYExpiracion(),
    ]);
  } catch (err) {
    console.error('[AlertasLlegada] Error general:', err.message);
  }
}

// Ejecutar inmediatamente y luego cada minuto (60000ms)
runCrons();
setInterval(runCrons, 60000);

console.log('[Worker] Alertas Llegada cron iniciado (cada minuto, enviando a Outbox).');
