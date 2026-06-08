const { DomainError } = require('../../../shared/domain/errors');

class PacienteNotFoundError extends DomainError {
  constructor() {
    super('PACIENTE_NO_ENCONTRADO', 'El paciente no existe o está inactivo', 404);
  }
}

class PacienteDuplicadoError extends DomainError {
  constructor() {
    super('PACIENTE_DUPLICADO', 'Ya existe un paciente con ese documento de identidad', 409);
  }
}

class InvalidDocumentError extends DomainError {
  constructor(message = 'Formato de documento de identidad inválido') {
    super('INVALID_DOCUMENT', message, 400);
  }
}

class InvalidDateError extends DomainError {
  constructor(message = 'Fecha de nacimiento inválida o en el futuro') {
    super('INVALID_DATE', message, 400);
  }
}

class PaginationError extends DomainError {
  constructor(message = 'Parámetros de paginación inválidos') {
    super('PAGINATION_ERROR', message, 400);
  }
}

module.exports = {
  PacienteNotFoundError,
  PacienteDuplicadoError,
  InvalidDocumentError,
  InvalidDateError,
  PaginationError
};
