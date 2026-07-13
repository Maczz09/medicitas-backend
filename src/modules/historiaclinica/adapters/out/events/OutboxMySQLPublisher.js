const { v4: uuidv4 } = require('uuid');
const { capturarTraceMeta } = require('../../../../../shared/infrastructure/traceContext');

class OutboxMySQLPublisher {
  /**
   * Inserta un evento en svc_hcl.outbox.
   * SIEMPRE recibe la conexión activa de la transacción SQL.
   * El Outbox Worker lo publicará a RabbitMQ de forma asíncrona.
   * _traceparent viaja dentro del payload — une la traza end-to-end (ver traceContext.js).
   */
  async publish(connection, nombreEvento, payload, correlationId) {
    const id = uuidv4();
    await connection.execute(
      `INSERT INTO svc_hcl.outbox (id_evento, tipo_evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
      [id, nombreEvento, JSON.stringify({ ...payload, ...capturarTraceMeta() }), correlationId || uuidv4()]
    );
  }
}

module.exports = { OutboxMySQLPublisher };
