const { DomainError } = require('../../../../../shared/domain/errors');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO_COMPLETAR = 'HistoriaClinica→Citas:completar';
const NOMBRE_SERVICIO_CONSULTAR = 'HistoriaClinica→Citas:consultar';

class CitaHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({
      baseUrl: process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000',
    });
    // Token interno para llamadas entre módulos
    this.internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();

    // Un Circuit Breaker POR MÉTODO, no uno compartido: completarCita trata
    // 409 (transición inválida — la cita ya no está En_Atencion, p. ej. la
    // cancelaron mientras tanto) como resultado de negocio, no como falla de
    // disponibilidad, mientras que obtenerEstadoCita hace lo mismo con 404.
    // Compartir un breaker abriría el circuito de uno por fallos del otro.
    const { breaker: breakerCompletar, registrarRecuperacion: registrarRecuperacionCompletar } = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO_COMPLETAR,
      servicioAfectado: 'Citas',
      accion: this._llamarCompletar.bind(this),
      errorFilter: (err) => err.response?.status === 409,
    });
    this.breakerCompletar = breakerCompletar;
    this.registrarRecuperacion = registrarRecuperacionCompletar;

    this.breakerConsultar = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO_CONSULTAR,
      servicioAfectado: 'Citas',
      accion: this._llamarConsultar.bind(this),
      errorFilter: (err) => err.response?.status === 404,
    }).breaker;
  }

  async _llamarCompletar(idCita, intento) {
    return this.cliente.patch(`/api/v2/citas/${idCita}/completar`, {}, {
      headers: { Authorization: `Bearer ${this.internalToken}` },
      timeout: obtenerTimeoutParaIntento(intento),
    });
  }

  async completarCita(idCita) {
    try {
      const { data } = await conReintentos(
        (intento) => this.breakerCompletar.fire(idCita, intento),
        { nombreServicio: NOMBRE_SERVICIO_COMPLETAR },
        logger,
      );
      return data;
    } catch (error) {
      // 409 = Citas rechazó la transición (la cita ya no está En_Atencion,
      // p. ej. la cancelaron mientras tanto) — resultado de negocio, no una
      // caída de la dependencia. El recovery-replay lo trata como "ya no
      // aplica, no reintentar más, alertar" en vez de reintentar indefinidamente.
      if (error.response?.status === 409) {
        throw new DomainError('CITA_TRANSICION_INVALIDA', 409, error.response?.data?.mensaje || 'La cita ya no puede completarse (el estado cambió).');
      }
      logger.error({ idCita, err: error.message, code: error.code }, '[HistoriaClinica→Citas] Error al completar la cita');
      throw crearErrorDependencia('Citas', error);
    }
  }

  async _llamarConsultar(idCita, intento) {
    return this.cliente.get(`/api/v2/citas/${idCita}`, {
      headers: { Authorization: `Bearer ${this.internalToken}` },
      timeout: obtenerTimeoutParaIntento(intento),
    });
  }

  async obtenerEstadoCita(idCita) {
    try {
      const { data } = await conReintentos(
        (intento) => this.breakerConsultar.fire(idCita, intento),
        { nombreServicio: NOMBRE_SERVICIO_CONSULTAR },
        logger,
      );
      // El endpoint puede devolver { data: {...} } o el objeto plano.
      const cita = data.data ? data.data : data;
      return { estado: cita.estado, idMedico: cita.idMedico ?? cita.id_medico ?? null };

    } catch (error) {
      if (error.response?.status === 404) {
        return null; // La cita no existe; el use case lanzará el DomainError correspondiente
      }

      logger.error({ idCita, err: error.message, code: error.code, data: error.response?.data }, '[HistoriaClinica→Citas] Error al consultar el estado de la cita');

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new DomainError('SERVICIO_CITAS_NO_DISPONIBLE', 'Servicio de Citas no responde. Intente de nuevo en unos momentos.', 503);
      }
      if (error.code === 'ECONNREFUSED') {
        throw new DomainError('SERVICIO_CITAS_NO_DISPONIBLE', 'Servicio de Citas no disponible.', 503);
      }
      if (error.code === 'EOPENBREAKER') {
        throw crearErrorDependencia('Citas', error);
      }
      // Bug descubierto al verificar en vivo: Citas respondiendo con CUALQUIER
      // HTTP status que no fuera 404 (ej. el 503 SERVICIO_NO_DISPONIBLE que
      // devuelve el kill-switch de demo, o un 5xx real) no tiene `.code` de
      // red ni es EOPENBREAKER, así que caía siempre en el 500 genérico de
      // abajo — un "caída de Citas" honesto se reportaba como error interno
      // confuso en vez de la dependencia no disponible que realmente es.
      if (error.response) {
        throw crearErrorDependencia('Citas', error);
      }
      // Error inesperado (ni respuesta HTTP ni código de red reconocido):
      // loguear y relanzar como error interno.
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al consultar el estado de la cita.', 500);
    }
  }
}

module.exports = { CitaHttpAdapter };
