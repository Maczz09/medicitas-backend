const { DomainError } = require('../../../shared/domain/errors');

class CitaConflictError extends DomainError {
  constructor(message = 'Conflicto en la cita', codigo = 'CITA_CONFLICTO') {
    super(message, codigo, 409);
  }
}

class TransicionEstadoInvalidaError extends DomainError {
  constructor(message = 'Transición de estado inválida') {
    super(message, 'TRANSICION_ESTADO_INVALIDA', 409);
  }
}

class FechaHoraInvalidaError extends DomainError {
  constructor(message = 'Fecha y hora inválidas') {
    super(message, 'FECHA_HORA_INVALIDA', 400);
  }
}

class ColisionHorarioError extends DomainError {
  constructor(message = 'El médico no tiene disponibilidad en este horario') {
    super(message, 'COLISION_HORARIO', 409);
  }
}

class DesincronizacionCacheError extends DomainError {
  constructor(message = 'El slot fue reservado por otro proceso') {
    super(message, 'DESINCRONIZACION_CACHE', 422);
  }
}

class CitaNoEncontradaError extends DomainError {
  constructor(message = 'Cita no encontrada') {
    super(message, 'CITA_NO_ENCONTRADA', 404);
  }
}

class PacienteNoDisponibleError extends DomainError {
  constructor(message = 'El servicio de pacientes no está disponible', statusCode = 503) {
    super(message, 'SERVICIO_PACIENTES_NO_DISPONIBLE', statusCode);
  }
}

module.exports = {
  CitaConflictError,
  TransicionEstadoInvalidaError,
  FechaHoraInvalidaError,
  ColisionHorarioError,
  DesincronizacionCacheError,
  CitaNoEncontradaError,
  PacienteNoDisponibleError
};
