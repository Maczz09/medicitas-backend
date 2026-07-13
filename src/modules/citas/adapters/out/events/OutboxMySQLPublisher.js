const { IEventPublisher } = require('../../../ports/out');
const { v4: uuidv4 } = require('uuid');
const { capturarTraceMeta } = require('../../../../../shared/infrastructure/traceContext');

class OutboxMySQLPublisher extends IEventPublisher {
  async publish(connection, nombreEvento, payload, correlationId) {
    const id = uuidv4();
    const query = `
      INSERT INTO svc_cit.outbox (id_evento, tipo_evento, payload, correlation_id)
      VALUES (?, ?, ?, ?)
    `;
    // _traceparent viaja dentro del payload para que la traza HTTP → outbox →
    // RabbitMQ → consumer quede como UNA cascada en Jaeger (ver traceContext.js).
    await connection.execute(query, [id, nombreEvento, JSON.stringify({ ...payload, ...capturarTraceMeta() }), correlationId || null]);
  }

  async publishIndependiente(nombreEvento, payload, correlationId) {
    const pool = require('../../../../../config/database');
    const id = uuidv4();
    const query = `
      INSERT INTO svc_cit.outbox (id_evento, tipo_evento, payload, correlation_id)
      VALUES (?, ?, ?, ?)
    `;
    await pool.execute(query, [id, nombreEvento, JSON.stringify({ ...payload, ...capturarTraceMeta() }), correlationId || null]);
  }
}

module.exports = { OutboxMySQLPublisher };
