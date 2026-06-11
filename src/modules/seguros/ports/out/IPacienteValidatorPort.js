class IPacienteValidatorPort {
  /**
   * @param {string} idPaciente
   * @returns {Promise<boolean>}
   */
  async existePaciente(idPaciente) {
    throw new Error('No implementado');
  }
}

module.exports = { IPacienteValidatorPort };
