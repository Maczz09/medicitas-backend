class IMensajesSMSRepository {
  /** @returns {Promise<MensajeSMS|null>} */
  async findByIdEvento(idEvento) { throw new Error('No implementado'); }
  /** Inserta el mensaje en una TX activa */
  async save(mensajeSMS, connection) { throw new Error('No implementado'); }
  /** @returns {Promise<MensajeSMS[]>} */
  async findByIdPaciente(idPaciente, { pagina, porPagina }) { throw new Error('No implementado'); }
}

module.exports = { IMensajesSMSRepository };
