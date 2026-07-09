class ISMSGateway {
  /**
   * Intenta enviar el SMS al número indicado.
   * @param {{ telefono: string, mensaje: string, idMensaje: string }} request
   * @returns {Promise<{ exitoso: boolean, referencia: string|null }>}
   * @throws {Error} Si el gateway falla (el use case trata esto como FALLIDO)
   */
  async enviar(request) { throw new Error('No implementado'); }

  /**
   * Envía un documento (ej. PDF) adjunto junto con un texto — en memoria,
   * el gateway nunca debe tocar disco. Implementación por defecto: gateways
   * que no soportan adjuntos (ej. SMS de texto plano) lanzan para que el
   * caller haga fallback al texto plano con el link.
   * @param {{ telefono: string, base64Data: string, nombreArchivo: string, mensajeTexto: string, idMensaje: string }} request
   * @returns {Promise<{ exitoso: boolean, referencia: string|null }>}
   * @throws {Error} Si el gateway no soporta adjuntos o falla el envío
   */
  async enviarPDFBase64(request) { throw new Error('Este gateway no soporta el envío de documentos adjuntos.'); }
}

module.exports = { ISMSGateway };
