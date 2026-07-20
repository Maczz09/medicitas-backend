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

    // Un Circuit Breaker POR MÉTODO, no uno compartido: completarCita no
    // tiene manejo de 404 propio (un 404 ahí es genuinamente anómalo, no un
    // flujo esperado), mientras que obtenerEstadoCita trata 404 como
    // resultado de negocio válido. Compartir un breaker abriría el circuito
    // de uno por fallos del otro.
    this.breakerCompletar = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO_COMPLETAR,
      servicioAfectado: 'Citas',
      accion: this._llamarCompletar.bind(this),
    }).breaker;

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
      // Error inesperado: loguear y relanzar como error interno
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al consultar el estado de la cita.', 500);
    }
  }
}

module.exports = { CitaHttpAdapter };
