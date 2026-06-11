class ISeriesRepository {
  /**
   * Incrementa la serie y retorna el número siguiente.
   * Siempre dentro de TX activa — nunca crea su propia conexión.
   * @returns {Promise<number>}
   */
  async siguienteNumero(tipo, connection) { throw new Error('No implementado'); }
}

module.exports = { ISeriesRepository };
