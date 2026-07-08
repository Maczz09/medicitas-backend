const { DomainError } = require('../../../shared/domain/errors');

// OJO: DomainError espera (codigo, mensaje, status) — codigo PRIMERO. Las
// clases de abajo llamaban a super(message, codigoString, status), con el
// orden invertido; la detección "es número → status" de DomainError no
// distingue eso (arg2 es un string en ambos casos), así que codigo/mensaje
// quedaban cruzados en cada respuesta: el cliente veía el código
// ("TRANSICION_ESTADO_INVALIDA") donde debía ir el texto humano, y viceversa.

class CitaConflictError extends DomainError {
  constructor(message = 'Conflicto en la cita', codigo = 'CITA_CONFLICTO') {
    super(codigo, message, 409);
  }
}

class TransicionEstadoInvalidaError extends DomainError {
  constructor(message = 'Transición de estado inválida') {
    super('TRANSICION_ESTADO_INVALIDA', message, 409);
  }
}

class FechaHoraInvalidaError extends DomainError {
  constructor(message = 'Fecha y hora inválidas') {
    super('FECHA_HORA_INVALIDA', message, 400);
  }
}

class ColisionHorarioError extends DomainError {
  constructor(message = 'El médico no tiene disponibilidad en este horario') {
    super('COLISION_HORARIO', message, 409);
  }
}

class DesincronizacionCacheError extends DomainError {
  constructor(message = 'El slot fue reservado por otro proceso') {
    super('DESINCRONIZACION_CACHE', message, 422);
  }
}

class CitaNoEncontradaError extends DomainError {
  constructor(message = 'Cita no encontrada') {
    super('CITA_NO_ENCONTRADA', message, 404);
  }
}

class PacienteNoDisponibleError extends DomainError {
  constructor(message = 'El servicio de pacientes no está disponible', statusCode = 503) {
    super('SERVICIO_PACIENTES_NO_DISPONIBLE', message, statusCode);
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
