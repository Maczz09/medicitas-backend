const axios = require('axios');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const logger = require('../../../../../shared/logger/logger');

class CoberturaHttpAdapter {
  constructor() {
    this.baseUrl = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  }

  async obtenerCobertura(idValidacion) {
    try {
      const url = `${this.baseUrl}/api/v2/coberturas/${idValidacion}`;
      
      const response = await conReintentos(() => axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.internalToken}`,
          'X-Internal-Service': 'true'
        },
        timeout: 5000
      }), {}, logger);

      return {
        estadoCobertura: response.data.estadoCobertura,
        codigoAutorizacion: response.data.codigoAutorizacion,
      };

    } catch (err) {
      if (err.response && err.response.status === 404) {
        return null;
      }
      
      logger.error({ err, idValidacion }, 'Error al comunicarse con SVC-SEG-003 (Seguros)');
      throw new Error('SERVICIO_SEGUROS_NO_DISPONIBLE'); 
    }
  }
}

module.exports = { CoberturaHttpAdapter };
