const { IMedicoValidatorPort } = require('../../../ports/out');
const pool = require('../../../../../config/database');

class MedicoValidatorAdapter extends IMedicoValidatorPort {
  async existeMedicoActivo(idMedico) {
    const [rows] = await pool.query(
      `SELECT 1 FROM svc_med.medicos WHERE id_medico = ? AND activo = 1 LIMIT 1`,
      [idMedico],
    );
    return rows.length > 0;
  }
}

module.exports = { MedicoValidatorAdapter };
