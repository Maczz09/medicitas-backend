const { DomainError } = require('../../../../shared/domain/errors');

const TIPOS_VALIDOS = Object.freeze({
  BOLETA:  'BOLETA',
  FACTURA: 'FACTURA',
});

class TipoComprobante {
  constructor(valor) {
    const normalizado = (valor || '').trim().toUpperCase();
    if (!Object.values(TIPOS_VALIDOS).includes(normalizado)) {
      throw new DomainError(
        'TIPO_COMPROBANTE_INVALIDO', 400,
        `Tipo de comprobante inválido: '${valor}'. Valores permitidos: BOLETA, FACTURA`
      );
    }
    this.valor = normalizado;
  }
  toString() { return this.valor; }
}

module.exports = { TipoComprobante, TIPOS_VALIDOS };
