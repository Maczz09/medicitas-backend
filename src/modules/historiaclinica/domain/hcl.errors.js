const { DomainError } = require('../../../shared/domain/errors');

class ExpedienteDuplicadoError extends DomainError {
  constructor() {
    super('EXPEDIENTE_DUPLICADO', 'El paciente ya tiene un expediente clínico abierto', 409);
  }
}

class ExpedienteNoEncontradoError extends DomainError {
  constructor() {
    super('EXPEDIENTE_NO_ENCONTRADO', 'No se encontró el expediente del paciente', 404);
  }
}

module.exports = { ExpedienteDuplicadoError, ExpedienteNoEncontradoError };
