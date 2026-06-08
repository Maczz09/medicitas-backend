const { DomainError } = require('../../../shared/domain/errors');

class MedicoNoDisponibleError extends DomainError {
  constructor() {
    super('MEDICO_NO_DISPONIBLE', 'El médico no tiene disponibilidad en este horario', 409);
  }
}

class CitaNoEncontradaError extends DomainError {
  constructor() {
    super('CITA_NO_ENCONTRADA', 'La cita especificada no existe', 404);
  }
}

class CitaInvalidaError extends DomainError {
  constructor(msg) {
    super('CITA_INVALIDA', msg, 400);
  }
}

module.exports = { MedicoNoDisponibleError, CitaNoEncontradaError, CitaInvalidaError };
