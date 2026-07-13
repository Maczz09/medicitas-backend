const { v4: uuidv4 } = require('uuid');
const { capturarTraceMeta } = require('../../../../shared/infrastructure/traceContext');

class OutboxEventPublisher {
  async publish(conn, evento, payload, correlationId) {
    const query = `
      INSERT INTO svc_pre.outbox (id_evento, tipo_evento, payload, correlation_id)
      VALUES (?, ?, ?, ?)
    `;
    // _traceparent viaja dentro del payload — une la traza end-to-end (ver traceContext.js)
    const params = [
      uuidv4(),
      evento,
      JSON.stringify({ ...payload, ...capturarTraceMeta() }),
      correlationId || null
    ];
    await conn.query(query, params);
  }
}

module.exports = OutboxEventPublisher;
