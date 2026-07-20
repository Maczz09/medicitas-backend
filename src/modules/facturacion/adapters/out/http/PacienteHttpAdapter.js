const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Facturacion→Pacientes';

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

  async obtenerNombre(idPaciente) {
    try {
      const resp = await conReintentos(
        (intento) => this.breaker.fire(idPaciente, intento),
        { nombreServicio: NOMBRE_SERVICIO },
        logger,
      );
      return `${resp.data.nombres} ${resp.data.apellidos}`;
    } catch (error) {
      logger.warn({ idPaciente, error: error.message }, 'No se pudo obtener el nombre del paciente desde SVC-PAC-005');
      return null;
    }
  }
}

module.exports = { PacienteHttpAdapter };
