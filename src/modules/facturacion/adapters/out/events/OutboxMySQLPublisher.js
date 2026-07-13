const { v4: uuidv4 } = require('uuid');
const logger = require('../../../../../shared/logger/logger');
const { capturarTraceMeta } = require('../../../../../shared/infrastructure/traceContext');

class OutboxMySQLPublisher {
  constructor(getConnectionFn) {
    this.getConnection = getConnectionFn;
  }

  async publish(connection, evento, payload, correlationId) {
    const id = uuidv4();
    try {
      // _traceparent viaja dentro del payload — une la traza end-to-end (ver traceContext.js)
      await connection.execute(
        `INSERT INTO svc_fac.outbox (id_evento, tipo_evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
        [id, evento, JSON.stringify({ ...payload, ...capturarTraceMeta() }), correlationId]
      );
      logger.info({ id, evento, correlationId }, 'Evento guardado en Outbox (Facturacion)');
    } catch (error) {
      logger.error({ error, evento, correlationId }, 'Error al guardar evento en Outbox (Facturacion)');
      throw error;
    }
  }
}

module.exports = { OutboxMySQLPublisher };
