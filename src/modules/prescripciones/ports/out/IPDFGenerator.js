class IPDFGenerator {
  /**
   * Valida que el PDF de la receta se puede generar (en memoria, sin tocar
   * disco) y devuelve la URL de descarga; la descarga regenera el PDF al vuelo.
   * @returns {Promise<{ urlDescarga: string }>}
   */
  async generar(receta) { throw new Error('No implementado'); }

  /**
   * Genera el PDF de la receta como Buffer en memoria (para la descarga).
   * @returns {Promise<Buffer>}
   */
  async generarBuffer(receta) { throw new Error('No implementado'); }
}

module.exports = { IPDFGenerator };
