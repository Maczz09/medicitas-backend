const db = require('../../../config/database');

class MySQLCitasRepository {
  async create(cita, conn = db) {
    await conn.query(
      `INSERT INTO svc_cit.citas (id_cita, id_paciente, id_medico, especialidad, fecha_hora, estado)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cita.id_cita, cita.id_paciente, cita.id_medico, cita.especialidad, cita.fecha_hora, cita.estado]
    );
  }

  async findById(idCita, conn = db) {
    const [rows] = await conn.query(`SELECT * FROM svc_cit.citas WHERE id_cita = ?`, [idCita]);
    return rows[0] || null;
  }

  async updateEstado(idCita, nuevoEstado, motivo = null, conn = db) {
    await conn.query(
      `UPDATE svc_cit.citas SET estado = ?, motivo_cancelacion = ? WHERE id_cita = ?`,
      [nuevoEstado, motivo, idCita]
    );
  }

  async existeCitaSolapada(idMedico, fechaHoraStr, conn = db) {
    const [rows] = await conn.query(
      `SELECT 1 FROM svc_cit.citas 
       WHERE id_medico = ? 
       AND fecha_hora = ? 
       AND estado NOT IN ('Cancelada', 'Reprogramada')`,
      [idMedico, fechaHoraStr]
    );
    return rows.length > 0;
  }
}

module.exports = MySQLCitasRepository;
