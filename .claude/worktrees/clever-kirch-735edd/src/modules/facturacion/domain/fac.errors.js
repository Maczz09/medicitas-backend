const { DomainError } = require('../../../shared/domain/errors');

class ComprobanteDuplicadoError extends DomainError {
  constructor() {
    super('COMPROBANTE_DUPLICADO', 'Ya existe un comprobante para este pago', 409);
  }
}

module.exports = { ComprobanteDuplicadoError };
