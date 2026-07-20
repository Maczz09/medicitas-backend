const { DomainError } = require('../../../../../shared/domain/errors');

class SeriesMySQLRepository {
  async siguienteNumero(tipo, connection) {
    try {
      await connection.execute(
        `UPDATE svc_fac.series_comprobante SET ultimo = ultimo + 1 WHERE tipo = ?`,
        [tipo]
      );
      const [rows] = await connection.execute(
        `SELECT ultimo FROM svc_fac.series_comprobante WHERE tipo = ?`,
        [tipo]
      );
      return rows[0].ultimo;
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_FAC', 500,
        'Error al generar el número de comprobante');
    }
  }
}

module.exports = { SeriesMySQLRepository };
