class IPDFGenerator {
  /**
   * Genera el PDF del comprobante y lo guarda en el filesystem.
   * @returns {Promise<{ rutaPdf: string, urlDescarga: string }>}
   */
  async generar(comprobante) { throw new Error('No implementado'); }
}

module.exports = { IPDFGenerator };
