const axios = require('axios');
const logger = require('../../../../../shared/logger/logger');

class PacienteHttpAdapter {
  constructor() {
    this.baseURL = process.env.PACIENTES_API_URL || 'http://localhost/api/v1/pacientes';
    this.token = process.env.INTERNAL_SERVICE_TOKEN;
  }

  async existePaciente(idPaciente) {
    try {
      await axios.get(`${this.baseURL}/${idPaciente}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
        timeout: 3000
      });
      return true;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return false;
      }
      logger.error({ idPaciente, error: error.message }, 'Error al consultar API de Pacientes desde Seguros');
      throw new Error('Servicio de pacientes no disponible');
    }
  }
}

module.exports = { PacienteHttpAdapter };
