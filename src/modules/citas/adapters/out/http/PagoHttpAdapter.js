const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Citas→Pagos';

/**
 * Adaptador S2S de Citas → Pagos. Permite a Citas consultar si una cita tiene
 * un pago aprobado antes de registrar el ingreso del paciente.
 */
class PagoHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();

    const { breaker } = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO,
      servicioAfectado: 'Pagos',
      accion: this._llamarPagos.bind(this),
      // 404 = la cita no tiene pago, resultado de negocio válido — no cuenta
      // como falla de disponibilidad del circuito.
      errorFilter: (err) => err.response?.status === 404,
    });
    this.breaker = breaker;
  }

  // `intento` (1-based) lo reenvía opossum desde breaker.fire(idCita, intento).
  async _llamarPagos(idCita, intento) {
    return this.cliente.get(`/api/v2/pagos/cita/${idCita}`, {
      headers: { Authorization: `Bearer ${this.internalToken}` },
      timeout: obtenerTimeoutParaIntento(intento),
    });
  }

  /**
   * Devuelve { estado } del pago de la cita, o null si no existe pago.
   * `estado` esperado: 'APROBADO' | 'REVERSADO'.
   */
  async obtenerPagoDeCita(idCita) {
    try {
      const { data } = await conReintentos(
        (intento) => this.breaker.fire(idCita, intento),
        { nombreServicio: NOMBRE_SERVICIO },
        logger,
      );
      const pago = data?.data ?? data;
      if (!pago || !pago.estado) return null;
      return { estado: pago.estado };
    } catch (err) {
      if (err.response?.status === 404) return null;
      logger.error({ err: err.message, code: err.code, idCita }, '[Citas→Pagos] Error al consultar el pago de la cita');
      throw crearErrorDependencia('Pagos', err);
    }
  }
}

module.exports = { PagoHttpAdapter };
