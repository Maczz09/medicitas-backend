const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO_CONSULTAR = 'Pagos→Citas:consultar';
const NOMBRE_SERVICIO_CANCELAR  = 'Pagos→Citas:cancelar';

class CitaHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;

    // Un Circuit Breaker por método: consultar trata 404 como "cita no
    // existe" (negocio válido); cancelar trata 404 Y 409 como éxito
    // idempotente. Compartir un breaker mezclaría ambas semánticas.
    this.breakerConsultar = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO_CONSULTAR,
      servicioAfectado: 'Citas',
      accion: this._llamarConsultar.bind(this),
      errorFilter: (err) => err.response?.status === 404,
    }).breaker;

    this.breakerCancelar = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO_CANCELAR,
      servicioAfectado: 'Citas',
      accion: this._llamarCancelar.bind(this),
      errorFilter: (err) => [404, 409].includes(err.response?.status),
    }).breaker;
  }

  async _llamarConsultar(idCita, intento) {
    return this.cliente.get(`/api/v2/citas/${idCita}`, {
      headers: {
        'Authorization': `Bearer ${this.internalToken}`,
        'X-Internal-Service': 'true'
      },
      timeout: obtenerTimeoutParaIntento(intento), // Falla rápido si CITAS no responde
    });
  }

  async obtenerEstadoCita(idCita) {
    try {
      const response = await conReintentos(
        (intento) => this.breakerConsultar.fire(idCita, intento),
        { nombreServicio: NOMBRE_SERVICIO_CONSULTAR },
        logger,
      );

      return { estado: response.data.estado };

    } catch (err) {
      if (err.response && err.response.status === 404) {
        return null;
      }

      logger.error({ err, idCita }, 'Error al comunicarse con SVC-CIT-001 (Citas)');
      // Si el servicio no responde, fallamos explícitamente para proteger la consistencia
      throw crearErrorDependencia('Citas', err);
    }
  }

  async _llamarCancelar({ idCita, motivo }, intento) {
    return this.cliente.patch(`/api/v2/citas/${idCita}/cancelar`, { motivo }, {
      headers: { Authorization: `Bearer ${this.internalToken}`, 'X-Internal-Service': 'true' },
      timeout: obtenerTimeoutParaIntento(intento),
    });
  }

  /**
   * Compensación: cancela la cita asociada a un pago reversado (lo que libera
   * su slot en la caché de disponibilidad). Idempotente — si la cita ya está
   * cancelada, el endpoint responde 409 y se ignora sin romper.
   * Devuelve true si la compensación se aplicó o ya estaba aplicada.
   */
  async cancelarCita(idCita, motivo) {
    try {
      await conReintentos(
        (intento) => this.breakerCancelar.fire({ idCita, motivo }, intento),
        { nombreServicio: NOMBRE_SERVICIO_CANCELAR },
        logger,
      );
      return true;
    } catch (err) {
      // 404 (cita inexistente) o 409 (ya cancelada/estado no cancelable) →
      // la compensación no aplica pero no es un fallo real.
      const st = err.response?.status;
      if (st === 404 || st === 409) return true;
      // Con el CB nuevo, `false` puede significar "reintentó 3 veces y
      // falló" O "el circuito estaba abierto y ni lo intentó" — sin loguear
      // el código no se distinguen en un incidente. Antes este catch
      // tragaba el error por completo, sin dejar rastro.
      logger.warn({ idCita, err: err.message, code: err.code }, '[Pagos→Citas] Compensación de cancelación no aplicada — quedará para reconciliación vía PagoReversado');
      return false; // fallo transitorio: quedará para reconciliación vía el evento PagoReversado
    }
  }
}

module.exports = { CitaHttpAdapter };
