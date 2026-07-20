const { DomainError } = require('../../../shared/domain/errors');

class CoberturaRechazadaError extends DomainError {
  constructor(motivo) {
    super('COBERTURA_RECHAZADA', `La aseguradora rechazó la cobertura: ${motivo}`, 422);
  }
}

class AseguradoraTimeoutError extends DomainError {
  constructor() {
    super('ASEGURADORA_TIMEOUT', 'El servicio de la aseguradora no responde', 503);
  }
}

module.exports = { CoberturaRechazadaError, AseguradoraTimeoutError };
