const axios = require('axios');
const { DomainError } = require('../../../../../shared/domain/errors');

class CitaHttpAdapter {
  constructor() {
    this.baseUrl = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    // Token interno para llamadas entre módulos
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  }

  async obtenerEstadoCita(idCita) {
    try {
      const { data } = await axios.get(
        `${this.baseUrl}/api/v1/citas/${idCita}`,
        {
          headers: { Authorization: `Bearer ${this.internalToken}` },
          timeout: 3000,
        }
      );
      // Asumiendo que el endpoint de citas devuelve { data: { estado: ... } }
      const estado = data.data ? data.data.estado : data.estado;
      return { estado };

    } catch (error) {
      console.error('ERROR EN AXIOS CitaHttpAdapter:', error.message);
      if (error.response) console.error('Data:', error.response.data);
      
      if (error.response?.status === 404) {
        return null; // La cita no existe; el use case lanzará el DomainError correspondiente
      }
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new DomainError('SERVICIO_CITAS_NO_DISPONIBLE', 'Servicio de Citas no responde. Intente de nuevo en unos momentos.', 503);
      }
      if (error.code === 'ECONNREFUSED') {
        throw new DomainError('SERVICIO_CITAS_NO_DISPONIBLE', 'Servicio de Citas no disponible.', 503);
      }
      // Error inesperado: loguear y relanzar como error interno
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al consultar el estado de la cita.', 500);
    }
  }
}

module.exports = { CitaHttpAdapter };
