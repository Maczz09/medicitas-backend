const { DomainError } = require('../../../shared/domain/errors');

class MedicoNotFoundError extends DomainError {
  constructor() {
    super('MEDICO_NO_ENCONTRADO', 'El médico no existe o está inactivo', 404);
  }
}

class MedicoDuplicadoError extends DomainError {
  constructor() {
    super('MEDICO_DUPLICADO', 'Ya existe un médico con ese CMP', 409);
  }
}

module.exports = { MedicoNotFoundError, MedicoDuplicadoError };
