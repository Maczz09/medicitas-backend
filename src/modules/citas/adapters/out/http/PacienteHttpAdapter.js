const jwt = require('jsonwebtoken');
const { IPacienteValidatorPort } = require('../../../ports/out');
const { PacienteNoDisponibleError } = require('../../../domain/cita.errors');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Citas→Pacientes';

class PacienteHttpAdapter extends IPacienteValidatorPort {
  constructor() {
    super();
    // Antes: API_BASE_URL, no documentada en ningún .env* del repo — en todo
    // ambiente conocido corría siempre con el default hardcodeado. Unificada
    // a APP_INTERNAL_BASE_URL (mismo nombre que usan los otros 9 adaptadores
    // internos), origen bare — el path se arma en _llamarPacientes().
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });

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

  _generarInternalToken() {
    // El RBAC valida req.user.rolNombre === 'INTERNAL' para el bypass S2S.
    return jwt.sign(
      { sub: 'svc-cit', rolNombre: 'INTERNAL' },
      process.env.JWT_SECRET,
      { expiresIn: '1m' }
    );
  }

  // `intento` (1-based) lo reenvía opossum desde breaker.fire(idPaciente, intento).
  async _llamarPacientes(idPaciente, intento) {
    const token = this._generarInternalToken();
    return this.cliente.get(`/api/v2/pacientes/${idPaciente}`, {
      headers: { Authorization: `Bearer ${token}` },
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
      logger.error({ idPaciente, err: error.message }, '[Citas→Pacientes] Error al verificar existencia del paciente');
      throw new PacienteNoDisponibleError();
    }
  }
}

module.exports = { PacienteHttpAdapter };
