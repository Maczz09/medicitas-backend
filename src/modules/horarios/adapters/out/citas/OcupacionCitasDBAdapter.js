const { IOcupacionCitasPort } = require('../../../ports/out');
const pool = require('../../../../../config/database');

// Migrado del db.query() crudo que vivía inline dentro de
// medicos.usecases.js#getSlotsForDate — misma consulta, ahora detrás de un
// puerto nombrado en vez de una lectura cross-schema sin nombre dentro de
// otro módulo.
class OcupacionCitasDBAdapter extends IOcupacionCitasPort {
  async obtenerHorasOcupadas(idMedico, fecha) {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(c.fecha_hora, '%H:%i') AS hora,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_cit.citas c
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
       WHERE c.id_medico = ?
         AND DATE(c.fecha_hora) = ?
         AND c.estado NOT IN ('Cancelada', 'No_Asistida')`,
      [idMedico, fecha],
    );
    return rows.map((r) => ({ hora: r.hora, pacienteNombre: r.paciente_nombre }));
  }
}

module.exports = { OcupacionCitasDBAdapter };
