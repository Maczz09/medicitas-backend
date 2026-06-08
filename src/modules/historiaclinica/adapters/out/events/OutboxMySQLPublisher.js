const { v4: uuidv4 } = require('uuid');

class OutboxMySQLPublisher {
  /**
   * Inserta un evento en svc_hcl.outbox.
   * SIEMPRE recibe la conexión activa de la transacción SQL.
   * El Outbox Worker lo publicará a RabbitMQ de forma asíncrona.
   */
  async publish(connection, nombreEvento, payload, correlationId) {
    const id = uuidv4();
    await connection.execute(
      `INSERT INTO svc_hcl.outbox (id_evento, tipo_evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
      [id, nombreEvento, JSON.stringify(payload), correlationId || uuidv4()]
    );
  }
}

module.exports = { OutboxMySQLPublisher };
