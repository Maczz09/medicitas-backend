const { ICitasRepository } = require('../../../ports/out');
const { Cita } = require('../../../domain/entities/Cita');

class CitasMySQLRepository extends ICitasRepository {
  async findById(id) {
    const pool = require('../../../../../config/database');
    const [rows] = await pool.query('SELECT * FROM svc_cit.citas WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return new Cita({
      id: row.id,
      idPaciente: row.id_paciente,
      idMedico: row.id_medico,
      fechaHora: row.fecha_hora,
      especialidad: row.especialidad,
      estado: row.estado,
      correlationId: row.correlation_id,
      recordatorio30m: !!row.recordatorio_30m,
      alertaMin0: !!row.alerta_min0,
      alertaMin5: !!row.alerta_min5,
      alertaMin10: !!row.alerta_min10,
    });
  }

  async save(cita, connection) {
    const query = `
      INSERT INTO svc_cit.citas 
      (id, id_paciente, id_medico, fecha_hora, especialidad, estado, correlation_id, recordatorio_30m)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await connection.execute(query, [
      cita.id,
      cita.idPaciente,
      cita.idMedico,
      cita.fechaHora,
      cita.especialidad,
      cita.estado,
      cita.correlationId,
      cita.recordatorio30m ? 1 : 0,
    ]);
    return cita;
  }

  async update(cita, connection) {
    const query = `
      UPDATE svc_cit.citas 
      SET id_medico = ?, fecha_hora = ?, estado = ?, 
          recordatorio_30m = ?, alerta_min0 = ?, alerta_min5 = ?, alerta_min10 = ?
      WHERE id = ?
    `;
    const params = [
      cita.idMedico,
      cita.fechaHora,
      cita.estado,
      cita.recordatorio30m ? 1 : 0,
      cita.alertaMin0 ? 1 : 0,
      cita.alertaMin5 ? 1 : 0,
      cita.alertaMin10 ? 1 : 0,
      cita.id,
    ];
    
    if (connection) {
      await connection.execute(query, params);
    } else {
      const pool = require('../../../../../config/database');
      await pool.execute(query, params);
    }
    return cita;
  }

  async getPendientesAtrasadas(minutosAtraso) {
    const pool = require('../../../../../config/database');
    const query = `
      SELECT * FROM svc_cit.citas 
      WHERE estado = 'Pendiente' 
      AND fecha_hora <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
    `;
    const [rows] = await pool.query(query, [minutosAtraso]);
    return rows.map(row => new Cita({
      id: row.id,
      idPaciente: row.id_paciente,
      idMedico: row.id_medico,
      fechaHora: row.fecha_hora,
      especialidad: row.especialidad,
      estado: row.estado,
      correlationId: row.correlation_id,
      recordatorio30m: !!row.recordatorio_30m,
      alertaMin0: !!row.alerta_min0,
      alertaMin5: !!row.alerta_min5,
      alertaMin10: !!row.alerta_min10,
    }));
  }
}

module.exports = { CitasMySQLRepository };
