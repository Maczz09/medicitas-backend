const { DomainError } = require('../../../shared/domain/errors');

class PagoRechazadoError extends DomainError {
  constructor(motivo) {
    super('PAGO_RECHAZADO', `La pasarela rechazó el pago: ${motivo}`, 422);
  }
}

class PagoDuplicadoError extends DomainError {
  constructor() {
    super('PAGO_DUPLICADO', 'La cita ya se encuentra pagada', 409);
  }
}

module.exports = { PagoRechazadoError, PagoDuplicadoError };
