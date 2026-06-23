const { v4: uuidv4 } = require('uuid');

class OutboxEventPublisher {
  async publish(conn, evento, payload, correlationId) {
    const query = `
      INSERT INTO svc_pre.outbox (id, evento, payload, correlation_id, publicado)
      VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      uuidv4(),
      evento,
      JSON.stringify(payload),
      correlationId || null,
      0
    ];
    await conn.query(query, params);
  }
}

module.exports = OutboxEventPublisher;
