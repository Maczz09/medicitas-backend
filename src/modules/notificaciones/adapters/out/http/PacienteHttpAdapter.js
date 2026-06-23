const axios = require('axios');
const logger = require('../../../../../shared/logger/logger');

class PacienteHttpAdapter {
  constructor() {
    this.baseUrl       = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  }

  async obtenerTelefono(idPaciente) {
    try {
      const { data } = await axios.get(
        `${this.baseUrl}/api/v1/pacientes/${idPaciente}`,
        {
          headers: { Authorization: `Bearer ${this.internalToken}` },
          timeout: 3000,
        }
      );
      const telefono = data?.telefono?.trim();
      return telefono || null;
    } catch (err) {
      if (err.response?.status === 404) return null;
      // Timeout o refused → propagar para que el consumer haga NACK
      logger.warn({ idPaciente, code: err.code }, 'PacienteHttpAdapter: error al obtener teléfono');
      throw err;
    }
  }
}

module.exports = { PacienteHttpAdapter };
