class NumeroComprobante {
  static formatear(tipo, ultimo) {
    const prefijo = tipo === 'BOLETA' ? 'B001' : 'F001';
    return `${prefijo}-${String(ultimo).padStart(8, '0')}`;
  }

  static esValido(numero) {
    return /^(B001|F001)-\d{8}$/.test(numero);
  }
}

module.exports = { NumeroComprobante };
