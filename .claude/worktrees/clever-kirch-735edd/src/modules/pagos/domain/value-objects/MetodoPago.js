const { DomainError } = require('../../../../shared/domain/errors');

const METODOS_VALIDOS = Object.freeze({
  EFECTIVO: 'EFECTIVO',
  POS:      'POS',
});

class MetodoPago {
  constructor(valor) {
    const normalizado = (valor || '').trim().toUpperCase();
    if (!Object.values(METODOS_VALIDOS).includes(normalizado)) {
      throw new DomainError(
        'METODO_PAGO_INVALIDO', 400,
        `Método de pago inválido: '${valor}'. Valores permitidos: EFECTIVO, POS`
      );
    }
    this.valor = normalizado;
  }
  toString() { return this.valor; }
}

module.exports = { MetodoPago, METODOS_VALIDOS };
