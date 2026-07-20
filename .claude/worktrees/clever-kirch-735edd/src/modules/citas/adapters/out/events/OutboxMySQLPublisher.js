const { IEventPublisher } = require('../../../ports/out');
const { v4: uuidv4 } = require('uuid');

class OutboxMySQLPublisher extends IEventPublisher {
  async publish(connection, nombreEvento, payload, correlationId) {
    const id = uuidv4();
    const query = `
      INSERT INTO svc_cit.outbox (id, evento, payload, correlation_id)
      VALUES (?, ?, ?, ?)
    `;
    await connection.execute(query, [id, nombreEvento, JSON.stringify(payload), correlationId || null]);
  }

  async publishIndependiente(nombreEvento, payload, correlationId) {
    const pool = require('../../../../../config/database');
    const id = uuidv4();
    const query = `
      INSERT INTO svc_cit.outbox (id, evento, payload, correlation_id)
      VALUES (?, ?, ?, ?)
    `;
    await pool.execute(query, [id, nombreEvento, JSON.stringify(payload), correlationId || null]);
  }
}

module.exports = { OutboxMySQLPublisher };
