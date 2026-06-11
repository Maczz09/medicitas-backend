class ICitaValidatorPort {
  /** @returns {Promise<{ estado: string }|null>} */
  async obtenerEstadoCita(idCita) { throw new Error('No implementado'); }
}

module.exports = { ICitaValidatorPort };
