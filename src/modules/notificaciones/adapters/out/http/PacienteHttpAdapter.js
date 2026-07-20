const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Notificaciones→Pacientes';

// ATENCIÓN — este adaptador corre dentro de notificaciones.consumer.js, cuyo
// nack en error hace ACK inmediato + republica con x-retry-count incrementado
// SIN backoff propio (las colas clásicas de RabbitMQ no exponen contador de
// entregas). Con el horario fijo (3s/5s/8s) un solo mensaje puede tardar
// hasta ~22s en agotar sus 3 intentos ANTES de que el consumer decida
// reencolar — verificado en vivo (ver dry-run de la migración) que esto no
// forma un patrón patológico bajo prefetch(5), pero es la razón por la que
// este archivo se migró último y con una prueba dedicada.
class PacienteHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN;

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

  async obtenerTelefono(idPaciente) {
    try {
      const { data } = await conReintentos(
        (intento) => this.breaker.fire(idPaciente, intento),
        { nombreServicio: NOMBRE_SERVICIO },
        logger,
      );
      // El endpoint devuelve { data: paciente, correlationId }
      const paciente = data?.data ?? data;
      const telefono = paciente?.telefono?.trim();
      return telefono || null;
    } catch (err) {
      if (err.response?.status === 404) return null;
      // Timeout o refused → propagar para que el consumer haga NACK
      logger.warn({ idPaciente, code: err.code }, 'PacienteHttpAdapter: error al obtener teléfono');
      throw err;
    }
  }
}

module.exports = { PacienteHttpAdapter };
