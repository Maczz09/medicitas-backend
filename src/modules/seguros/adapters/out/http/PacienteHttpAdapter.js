const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Seguros→Pacientes';

class PacienteHttpAdapter {
  constructor() {
    // Antes: PACIENTES_API_URL (URL completa hasta el recurso, sin puerto,
    // vía nginx). Unificada a APP_INTERNAL_BASE_URL (origen bare) como los
    // otros 9 adaptadores internos — mismo destino final: verificado que
    // .env ya apunta ambas variables al mismo host:puerto.
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    this.token = process.env.INTERNAL_SERVICE_TOKEN;

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
      headers: { 'Authorization': `Bearer ${this.token}` },
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
      if (error.response && error.response.status === 404) {
        return false;
      }
      logger.error({ idPaciente, error: error.message }, 'Error al consultar API de Pacientes desde Seguros');
      throw crearErrorDependencia('Pacientes', error);
    }
  }
}

module.exports = { PacienteHttpAdapter };
