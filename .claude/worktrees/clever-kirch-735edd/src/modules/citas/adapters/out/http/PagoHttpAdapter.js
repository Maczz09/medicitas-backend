const axios = require('axios');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const logger = require('../../../../../shared/logger/logger');

/**
 * Adaptador S2S de Citas → Pagos. Permite a Citas consultar si una cita tiene
 * un pago aprobado antes de registrar el ingreso del paciente.
 */
class PagoHttpAdapter {
  constructor() {
    this.baseUrl = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  }

  /**
   * Devuelve { estado } del pago de la cita, o null si no existe pago.
   * `estado` esperado: 'APROBADO' | 'REVERSADO'.
   */
  async obtenerPagoDeCita(idCita) {
    try {
      const { data } = await conReintentos(() => axios.get(
        `${this.baseUrl}/api/v2/pagos/cita/${idCita}`,
        { headers: { Authorization: `Bearer ${this.internalToken}` }, timeout: 4000 }
      ), {}, logger);
      const pago = data?.data ?? data;
      if (!pago || !pago.estado) return null;
      return { estado: pago.estado };
    } catch (err) {
      if (err.response?.status === 404) return null;
      // Falla de transporte: se propaga para que el use case decida (fail-safe).
      throw err;
    }
  }
}

module.exports = { PagoHttpAdapter };
