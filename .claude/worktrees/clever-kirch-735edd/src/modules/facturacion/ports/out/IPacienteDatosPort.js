class IPacienteDatosPort {
  /**
   * Obtiene el nombre del paciente para incluirlo en el PDF.
   * Si falla → retorna null (no bloquea la generación del PDF).
   * @returns {Promise<string|null>}
   */
  async obtenerNombre(idPaciente) { throw new Error('No implementado'); }
}

module.exports = { IPacienteDatosPort };
