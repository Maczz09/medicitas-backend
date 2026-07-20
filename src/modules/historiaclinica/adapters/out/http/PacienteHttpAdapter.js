const { DomainError } = require('../../../../../shared/domain/errors');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'HistoriaClinica→Pacientes';

class PacienteHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();

    const { breaker } = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO,
      servicioAfectado: 'Pacientes',
      accion: this._llamarPacientes.bind(this),
      // 404 = paciente no existe, resultado de negocio válido — no cuenta
      // como falla de disponibilidad del circuito.
      errorFilter: (err) => err.response?.status === 404,
    });
    this.breaker = breaker;
  }

  // `intento` (1-based) lo reenvía opossum desde breaker.fire(idPaciente, intento).
  async _llamarPacientes(idPaciente, intento) {
    return this.cliente.get(`/api/v2/pacientes/${idPaciente}`, {
      headers: { Authorization: `Bearer ${this.internalToken}` },
      timeout: obtenerTimeoutParaIntento(intento),
    });
  }

  async existePaciente(idPaciente) {
    try {
      await conReintentos(
        (intento) => this.breaker.fire(idPaciente, intento),
        { nombreServicio: NOMBRE_SERVICIO },
        logger,
      );
      return true;

    } catch (error) {
      if (error.response?.status === 404) return false;

      logger.error({ idPaciente, err: error.message, code: error.code }, '[HistoriaClinica→Pacientes] Error al verificar existencia del paciente');

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        throw new DomainError('SERVICIO_PACIENTES_NO_DISPONIBLE', 'Servicio de Pacientes no disponible. Intente de nuevo.', 503);
      }
      if (error.code === 'EOPENBREAKER') {
        throw crearErrorDependencia('Pacientes', error);
      }
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al verificar existencia del paciente.', 500);
    }
  }
}

module.exports = { PacienteHttpAdapter };
