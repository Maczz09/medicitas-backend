class IEventPublisher {
  /**
   * @param {Object} connection - Conexión de MySQL para la transacción
   * @param {string} evento - Nombre del evento (ej. CoberturaValidada)
   * @param {Object} payload - Datos del evento
   * @param {string} correlationId
   * @returns {Promise<void>}
   */
  async publish(connection, evento, payload, correlationId) {
    throw new Error('No implementado');
  }
}

module.exports = { IEventPublisher };
