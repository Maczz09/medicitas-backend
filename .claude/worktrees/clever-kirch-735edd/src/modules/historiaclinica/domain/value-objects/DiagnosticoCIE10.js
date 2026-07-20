// Formato CIE-10: letra + 2 dígitos + punto opcional + dígito/letra opcional
// Ejemplos válidos: J01.9, A09, K92.1
const CIE10_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$/;

class DiagnosticoCIE10 {
  constructor(codigo) {
    const codigoLimpio = (codigo || '').trim().toUpperCase();
    if (!CIE10_REGEX.test(codigoLimpio)) {
      throw new Error(`Formato CIE-10 inválido: "${codigo}"`);
    }
    this.valor = codigoLimpio;
  }

  toString() {
    return this.valor;
  }
}

module.exports = { DiagnosticoCIE10 };
