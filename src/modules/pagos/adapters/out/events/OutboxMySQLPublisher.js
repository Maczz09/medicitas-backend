const { v4: uuidv4 } = require('uuid');

class OutboxMySQLPublisher {
  constructor(getConnection) {
    this.getConnection = getConnection;
  }

  async publish(connection, evento, payload, correlationId) {
    const id = uuidv4();
    const corrId = correlationId || uuidv4();

    // Guardar el evento en la tabla outbox de SVC-PAG en la misma transacción
    await connection.execute(
      `INSERT INTO svc_pag.outbox (id, evento, payload, correlation_id) 
       VALUES (?, ?, ?, ?)`,
      [id, evento, JSON.stringify(payload), corrId]
    );

    return id;
  }
}

module.exports = { OutboxMySQLPublisher };
