class IPacienteTelefonoPort {
  /**
   * @returns {Promise<string|null>} número de teléfono o null si no tiene
   */
  async obtenerTelefono(idPaciente) { throw new Error('No implementado'); }
}

module.exports = { IPacienteTelefonoPort };
