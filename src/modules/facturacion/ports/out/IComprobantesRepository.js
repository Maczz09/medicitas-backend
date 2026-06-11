class IComprobantesRepository {
  /** @returns {Promise<Comprobante|null>} */
  async findById(id) { throw new Error('No implementado'); }
  /** @returns {Promise<Comprobante|null>} */
  async findByIdPago(idPago) { throw new Error('No implementado'); }
  /** Guarda dentro de una TX activa */
  async save(comprobante, connection) { throw new Error('No implementado'); }
  /** Actualiza dentro de una TX activa */
  async update(comprobante, connection) { throw new Error('No implementado'); }
}

module.exports = { IComprobantesRepository };
