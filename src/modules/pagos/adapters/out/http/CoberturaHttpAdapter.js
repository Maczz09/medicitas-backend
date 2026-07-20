const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Pagos→Coberturas';

class CoberturaHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;

    const { breaker, registrarRecuperacion } = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO,
      servicioAfectado: 'Coberturas',
      accion: this._llamarCoberturas.bind(this),
      errorFilter: (err) => err.response?.status === 404,
    });
    this.breaker = breaker;
    this.registrarRecuperacion = registrarRecuperacion;
  }

  async _llamarCoberturas(idValidacion, intento) {
    return this.cliente.get(`/api/v2/coberturas/${idValidacion}`, {
      headers: {
        'Authorization': `Bearer ${this.internalToken}`,
        'X-Internal-Service': 'true'
      },
      timeout: obtenerTimeoutParaIntento(intento),
    });
  }

  async obtenerCobertura(idValidacion) {
    try {
      const response = await conReintentos(
        (intento) => this.breaker.fire(idValidacion, intento),
        { nombreServicio: NOMBRE_SERVICIO },
        logger,
      );

      return {
        estadoCobertura: response.data.estadoCobertura,
        codigoAutorizacion: response.data.codigoAutorizacion,
      };

    } catch (err) {
      if (err.response && err.response.status === 404) {
        return null;
      }

      logger.error({ err, idValidacion }, 'Error al comunicarse con SVC-SEG-003 (Seguros)');
      throw crearErrorDependencia('Seguros', err);
    }
  }
}

module.exports = { CoberturaHttpAdapter };
