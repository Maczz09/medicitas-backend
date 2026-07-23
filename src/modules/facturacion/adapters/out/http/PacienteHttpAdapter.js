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

    const { breaker, registrarRecuperacion } = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO,
      servicioAfectado: 'Pacientes',
      accion: this._llamarPacientes.bind(this),
      // 404 = paciente no existe, resultado de negocio válido — no cuenta
      // como falla de disponibilidad del circuito.
      errorFilter: (err) => err.response?.status === 404,
    });
    this.breaker = breaker;
    this.registrarRecuperacion = registrarRecuperacion;
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
      // Bug pre-existente descubierto al verificar la reconciliación en vivo:
      // GET /api/v2/pacientes/:id responde { data: { nombre, apellido, ... } }
      // (singular, envuelto en `data`) — este adaptador leía
      // `resp.data.nombres`/`apellidos` (plural, sin envoltura), que siempre
      // eran `undefined`. Todo comprobante emitido con Pacientes disponible
      // llevaba literalmente el nombre "undefined undefined" en el PDF.
      const paciente = resp.data?.data ?? resp.data;
      return `${paciente.nombre} ${paciente.apellido}`;
    } catch (error) {
      // 404 = el paciente no existe — resultado de negocio válido, nada que
      // reconciliar después.
      if (error.response?.status === 404) {
        logger.warn({ idPaciente }, 'Paciente no encontrado al obtener nombre para el comprobante');
        return null;
      }
      // Dependencia inalcanzable (timeout, circuito abierto) — se propaga
      // para que GenerarComprobanteUseCase marque nombreVerificado=false y lo
      // reconcilie automáticamente cuando Pacientes se recupere (ver
      // recovery-replay en server.js).
      logger.warn({ idPaciente, error: error.message }, 'Pacientes no disponible al obtener nombre para el comprobante — se emite sin nombre, queda pendiente de reconciliar');
      throw error;
    }
  }
}

module.exports = { PacienteHttpAdapter };
