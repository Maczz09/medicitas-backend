class IAseguradoraGateway {
  /**
   * Valida la póliza contra la aseguradora (real o simulada).
   *
   * @param {{ idPaciente, idAseguradora, numeroPoliza, tipoConsulta }} request
   * @returns {Promise<{
   *   estadoCobertura:     'APROBADA' | 'RECHAZADA' | 'PENDIENTE',
   *   porcentajeCobertura: number,
   *   codigoAutorizacion:  string | null,
   *   vigencia:            string | null,   // YYYY-MM-DD
   *   esFallback:          boolean,
   * }>}
   */
  async validarPoliza(request) {
    throw new Error('IAseguradoraGateway.validarPoliza no implementado');
  }
}

module.exports = { IAseguradoraGateway };
