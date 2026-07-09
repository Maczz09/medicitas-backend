class IDocumentoDownloaderPort {
  /**
   * Descarga un documento binario (ej. PDF) directamente a un Buffer en
   * memoria — la implementación NUNCA debe escribir a disco.
   * @param {string} url — URL de descarga del documento
   * @returns {Promise<Buffer>}
   * @throws {Error} Si la descarga falla (el caller decide el fallback)
   */
  async descargarBuffer(url) { throw new Error('No implementado'); }
}

module.exports = { IDocumentoDownloaderPort };
