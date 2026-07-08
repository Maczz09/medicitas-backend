const { DomainError } = require('../../../shared/domain/errors');

// DomainError espera (codigo, mensaje, status) — codigo SIEMPRE primero. Ver
// el bug real de src/modules/citas/domain/cita.errors.js (arreglado 2026-07-08):
// invertir este orden hace que el cliente vea el código crudo donde debía ir
// el texto humano, sin que nada lo detecte en desarrollo.

class RangoHorarioInvalidoError extends DomainError {
  constructor(message = 'El rango horario no es válido') {
    super('RANGO_HORARIO_INVALIDO', message, 400);
  }
}

class RangoBloqueoInvalidoError extends DomainError {
  constructor(message = 'El rango del bloqueo no es válido') {
    super('RANGO_BLOQUEO_INVALIDO', message, 400);
  }
}

class SemanaInvalidaError extends DomainError {
  constructor(message = 'La semana indicada no es válida') {
    super('SEMANA_INVALIDA', message, 400);
  }
}

class HorarioNoEncontradoError extends DomainError {
  constructor(message = 'No se encontró horario para el médico indicado') {
    super('HORARIO_NO_ENCONTRADO', message, 404);
  }
}

class MedicoNoEncontradoError extends DomainError {
  constructor(message = 'El médico indicado no existe o está inactivo') {
    super('MEDICO_NO_ENCONTRADO', message, 404);
  }
}

module.exports = {
  RangoHorarioInvalidoError,
  RangoBloqueoInvalidoError,
  SemanaInvalidaError,
  HorarioNoEncontradoError,
  MedicoNoEncontradoError,
};
