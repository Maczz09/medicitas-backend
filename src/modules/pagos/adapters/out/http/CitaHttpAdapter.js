const axios = require('axios');
const logger = require('../../../../../shared/logger/logger');

class CitaHttpAdapter {
  constructor() {
    this.baseUrl = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  }

  async obtenerEstadoCita(idCita) {
    try {
      const url = `${this.baseUrl}/api/v1/citas/${idCita}`;
      
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.internalToken}`,
          'X-Internal-Service': 'true'
        },
        timeout: 5000 // Falla rápido si CITAS no responde
      });

      return { estado: response.data.estado };

    } catch (err) {
      if (err.response && err.response.status === 404) {
        return null;
      }
      
      logger.error({ err, idCita }, 'Error al comunicarse con SVC-CIT-001 (Citas)');
      // Si el servicio no responde, fallamos explícitamente para proteger la consistencia
      throw new Error('SERVICIO_CITAS_NO_DISPONIBLE'); 
    }
  }
}

module.exports = { CitaHttpAdapter };
