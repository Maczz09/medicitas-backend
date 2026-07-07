const axios = require('axios');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const logger = require('../../../../../shared/logger/logger');

class CitaHttpAdapter {
  constructor() {
    this.baseUrl = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  }

  async obtenerEstadoCita(idCita) {
    try {
      const url = `${this.baseUrl}/api/v1/citas/${idCita}`;
      
      const response = await conReintentos(() => axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.internalToken}`,
          'X-Internal-Service': 'true'
        },
        timeout: 5000 // Falla rápido si CITAS no responde
      }), {}, logger);

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

  /**
   * Compensación: cancela la cita asociada a un pago reversado (lo que libera
   * su slot en la caché de disponibilidad). Idempotente — si la cita ya está
   * cancelada, el endpoint responde 409 y se ignora sin romper.
   * Devuelve true si la compensación se aplicó o ya estaba aplicada.
   */
  async cancelarCita(idCita, motivo) {
    try {
      await conReintentos(() => axios.patch(
        `${this.baseUrl}/api/v1/citas/${idCita}/cancelar`,
        { motivo },
        {
          headers: { Authorization: `Bearer ${this.internalToken}`, 'X-Internal-Service': 'true' },
          timeout: 5000,
        }
      ), {}, logger);
      return true;
    } catch (err) {
      // 404 (cita inexistente) o 409 (ya cancelada/estado no cancelable) →
      // la compensación no aplica pero no es un fallo real.
      const st = err.response?.status;
      if (st === 404 || st === 409) return true;
      return false; // fallo transitorio: quedará para reconciliación vía el evento PagoReversado
    }
  }
}

module.exports = { CitaHttpAdapter };
