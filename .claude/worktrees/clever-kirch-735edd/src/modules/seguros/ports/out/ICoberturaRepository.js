class ICoberturaRepository {
  /** @returns {Promise<Cobertura>} */
  async save(cobertura, connection) { throw new Error('No implementado'); }

  /** @returns {Promise<Cobertura|null>} */
  async findById(id) { throw new Error('No implementado'); }
}

module.exports = { ICoberturaRepository };
