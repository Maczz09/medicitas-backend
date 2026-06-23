class ITrazasRepository {
  /**
   * Inserta la traza. Si id_evento ya existe (ER_DUP_ENTRY),
   * debe tratarse como éxito idempotente, NO como error.
   * @returns {Promise<{ insertada: boolean }>} insertada=false si fue duplicado
   */
  async insertar(traza) { throw new Error('No implementado'); }

  /**
   * @returns {Promise<{ total: number, trazas: Traza[] }>}
   */
  async buscarConFiltros({ servicio, tipoEvento, desde, hasta, correlationId, pagina, porPagina }) {
    throw new Error('No implementado');
  }

  /**
   * @returns {Promise<Traza[]>} ordenado cronológicamente
   */
  async buscarPorCorrelationId(correlationId) { throw new Error('No implementado'); }
}

module.exports = { ITrazasRepository };
