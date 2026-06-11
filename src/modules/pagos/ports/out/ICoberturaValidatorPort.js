class ICoberturaValidatorPort {
  /** @returns {Promise<{ estadoCobertura: string, codigoAutorizacion: string }|null>} */
  async obtenerCobertura(idValidacion) { throw new Error('No implementado'); }
}

module.exports = { ICoberturaValidatorPort };
