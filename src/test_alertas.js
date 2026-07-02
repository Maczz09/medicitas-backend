require('dotenv').config();
const db = require('../src/config/database');
const crypto = require('crypto');

function fmtHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

async function publicarEvento(conn, tipoEvento, idCita, payload) {
  const idEvento = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  
  await conn.execute(
    `INSERT INTO svc_cit.outbox (id_evento, tipo_evento, payload, correlation_id)
     VALUES (?, ?, ?, ?)`,
    [idEvento, tipoEvento, JSON.stringify(payload), correlationId]
  );
}

async function run() {
  console.log('Fetching citas for alertas...');
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

  console.log(`Found ${citas.length} citas.`);
  
  for (const cita of citas) {
    console.log(`Processing cita ${cita.id}`);
    const diffMin = Math.floor((Date.now() - new Date(cita.fecha_hora).getTime()) / 60000);
    const hora    = fmtHora(cita.fecha_hora);
    console.log(`diffMin is ${diffMin}`);

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
      console.error(`[AlertasLlegada] Error cita ${cita.id}:`, err);
    } finally {
      conn.release();
    }
  }
  process.exit(0);
}

run();
