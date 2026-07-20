const { DomainError } = require('../../../../shared/domain/errors');

class MontosPago {
  constructor({ montoTotal, montoCubiertoSeguro = 0, montoCopago }) {
    const total    = parseFloat(montoTotal);
    const cubierto = parseFloat(montoCubiertoSeguro || 0);
    const copago   = parseFloat(montoCopago);

    if (isNaN(total)    || total   <= 0) throw new DomainError('MONTO_INVALIDO', 400, 'montoTotal debe ser mayor a 0');
    if (isNaN(copago)   || copago  <= 0) throw new DomainError('MONTO_INVALIDO', 400, 'montoCopago debe ser mayor a 0');
    if (isNaN(cubierto) || cubierto < 0) throw new DomainError('MONTO_INVALIDO', 400, 'montoCubiertoSeguro no puede ser negativo');

    const suma            = Math.round((cubierto + copago) * 100) / 100;
    const totalRedondeado = Math.round(total * 100) / 100;

    if (Math.abs(suma - totalRedondeado) > 0.01) {
      throw new DomainError(
        'MONTO_INCONSISTENTE', 422,
        `Los montos no cuadran: ${cubierto} (seguro) + ${copago} (copago) = ${suma} ≠ ${total} (total)`
      );
    }

    Object.freeze(Object.assign(this, {
      montoTotal:          totalRedondeado,
      montoCubiertoSeguro: Math.round(cubierto * 100) / 100,
      montoCopago:         Math.round(copago   * 100) / 100,
    }));
  }

  tieneCobertura() { return this.montoCubiertoSeguro > 0; }
}

module.exports = { MontosPago };
