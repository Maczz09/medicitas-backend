const axios = require('axios');
const { DomainError } = require('../../../../../shared/domain/errors');

class PacienteHttpAdapter {
  constructor() {
    this.baseUrl       = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  }

  async existePaciente(idPaciente) {
    try {
      await axios.get(
        `${this.baseUrl}/api/v1/pacientes/${idPaciente}`,
        {
          headers: { Authorization: `Bearer ${this.internalToken}` },
          timeout: 3000,
        }
      );
      return true;

    } catch (error) {
      if (error.response?.status === 404) return false;
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        throw new DomainError('SERVICIO_PACIENTES_NO_DISPONIBLE', 'Servicio de Pacientes no disponible. Intente de nuevo.', 503);
      }
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al verificar existencia del paciente.', 500);
    }
  }
}

module.exports = { PacienteHttpAdapter };
