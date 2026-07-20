class ISMSGateway {
  /**
   * Intenta enviar el SMS al número indicado.
   * @param {{ telefono: string, mensaje: string, idMensaje: string }} request
   * @returns {Promise<{ exitoso: boolean, referencia: string|null }>}
   * @throws {Error} Si el gateway falla (el use case trata esto como FALLIDO)
   */
  async enviar(request) { throw new Error('No implementado'); }
}

module.exports = { ISMSGateway };
