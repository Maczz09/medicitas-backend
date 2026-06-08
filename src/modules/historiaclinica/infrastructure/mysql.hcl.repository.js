const db = require('../../../config/database');

class MySQLHclRepository {
  async buscarExpedientePorPaciente(idPaciente, conn = db) {
    const [rows] = await conn.query(
      `SELECT * FROM svc_hcl.expedientes WHERE id_paciente = ?`,
      [idPaciente]
    );
    return rows[0] || null;
  }

  async crearExpediente(expediente, conn = db) {
    await conn.query(
      `INSERT INTO svc_hcl.expedientes (id_expediente, id_paciente, grupo_sanguineo, alergias_conocidas, antecedentes)
       VALUES (?, ?, ?, ?, ?)`,
      [
        expediente.id_expediente, expediente.id_paciente, expediente.grupo_sanguineo,
        JSON.stringify(expediente.alergias_conocidas || []), JSON.stringify(expediente.antecedentes || [])
      ]
    );
  }

  async registrarEncuentro(encuentro, conn = db) {
    await conn.query(
      `INSERT INTO svc_hcl.encuentros_clinicos 
       (id_encuentro, id_expediente, id_medico, id_cita, fecha_hora, diagnostico_cie10, diagnostico_descripcion, notas_evolucion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        encuentro.id_encuentro, encuentro.id_expediente, encuentro.id_medico, encuentro.id_cita,
        encuentro.fecha_hora, encuentro.diagnostico_cie10, encuentro.diagnostico_descripcion, encuentro.notas_evolucion
      ]
    );
  }
}

module.exports = MySQLHclRepository;
