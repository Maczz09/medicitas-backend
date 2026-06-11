const axios = require('axios');
const logger = require('../../../../../shared/logger/logger');

class PacienteHttpAdapter {
  constructor() {
    this.baseUrl = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN || 'internal-secret-token';
  }

  async obtenerNombre(idPaciente) {
    try {
      const resp = await axios.get(`${this.baseUrl}/api/v1/pacientes/${idPaciente}`, {
        headers: { Authorization: `Bearer ${this.internalToken}` },
        timeout: 2000,
      });
      return `${resp.data.nombres} ${resp.data.apellidos}`;
    } catch (error) {
      logger.warn({ idPaciente, error: error.message }, 'No se pudo obtener el nombre del paciente desde SVC-PAC-005');
      return null;
    }
  }
}

module.exports = { PacienteHttpAdapter };
