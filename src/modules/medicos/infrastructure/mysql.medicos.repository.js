const db = require('../../../config/database');

class MySQLMedicosRepository {
  async findByCmp(cmp) {
    const [rows] = await db.query(`SELECT * FROM svc_med.medicos WHERE cmp = ?`, [cmp]);
    return rows[0] || null;
  }

  async findById(idMedico) {
    const [rows] = await db.query(`SELECT * FROM svc_med.medicos WHERE id_medico = ? AND activo = 1`, [idMedico]);
    return rows[0] || null;
  }

  async findAll() {
    const [rows] = await db.query(
      `SELECT id_medico, nombre, apellido, cmp, especialidad, activo
       FROM svc_med.medicos WHERE activo = 1
       ORDER BY apellido, nombre`
    );
    return rows;
  }

  async create(medico) {
    await db.query(
      `INSERT INTO svc_med.medicos (id_medico, nombre, apellido, cmp, especialidad) VALUES (?, ?, ?, ?, ?)`,
      [medico.id_medico, medico.nombre, medico.apellido, medico.cmp, medico.especialidad]
    );
  }

  async getHorarios(idMedico) {
    const [rows] = await db.query(`SELECT * FROM svc_med.horarios_base WHERE id_medico = ? AND activo = 1`, [idMedico]);
    return rows;
  }

  async getBloqueos(idMedico) {
    const [rows] = await db.query(`SELECT * FROM svc_med.bloqueos_agenda WHERE id_medico = ? AND fecha_fin >= NOW()`, [idMedico]);
    return rows;
  }

  async saveHorarios(idMedico, horarios) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM svc_med.horarios_base WHERE id_medico = ?`, [idMedico]);
      
      for (const h of horarios) {
        const idHorario = require('uuid').v4();
        await conn.query(
          `INSERT INTO svc_med.horarios_base (id_horario, id_medico, dia_semana, hora_inicio, hora_fin, duracion_cita_min)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [idHorario, idMedico, h.dia_semana, h.hora_inicio, h.hora_fin, h.duracion_cita_min]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async saveBloqueo(bloqueo) {
    await db.query(
      `INSERT INTO svc_med.bloqueos_agenda (id_bloqueo, id_medico, fecha_inicio, fecha_fin, motivo)
       VALUES (?, ?, ?, ?, ?)`,
      [bloqueo.id_bloqueo, bloqueo.id_medico, bloqueo.fecha_inicio, bloqueo.fecha_fin, bloqueo.motivo]
    );
  }
}

module.exports = MySQLMedicosRepository;
