class IPDFGenerator {
  /**
   * Valida que el PDF del comprobante se puede generar (en memoria, sin tocar
   * disco) y devuelve la URL de descarga; la descarga regenera el PDF al vuelo.
   * @returns {Promise<{ urlDescarga: string }>}
   */
  async generar(comprobante) { throw new Error('No implementado'); }

  /**
   * Genera el PDF del comprobante como Buffer en memoria (para la descarga).
   * @returns {Promise<Buffer>}
   */
  async generarBuffer(comprobante) { throw new Error('No implementado'); }
}

module.exports = { IPDFGenerator };
