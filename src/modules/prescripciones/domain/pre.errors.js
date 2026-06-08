const { DomainError } = require('../../../shared/domain/errors');

class PrescripcionNoEncontradaError extends DomainError {
  constructor() {
    super('PRESCRIPCION_NO_ENCONTRADA', 'La prescripción solicitada no existe', 404);
  }
}

module.exports = { PrescripcionNoEncontradaError };
