const { IEventPublisher } = require('../../../ports/out');
const { v4: uuidv4 } = require('uuid');

// Mismo patrón que citas/prescripciones: publish(connection,...) usa la
// conexión de la transacción que llama — atómico con el cambio de datos que
// lo origina. A diferencia de medicos.usecases.js#_emit (que abre su propia
// conexión aparte y traga errores con console.warn), un fallo aquí revierte
// la transacción completa, y el evento nunca se separa del cambio real.
class OutboxMySQLPublisher extends IEventPublisher {
  async publish(connection, nombreEvento, payload, correlationId) {
    const id = uuidv4();
    await connection.execute(
      `INSERT INTO svc_hor.outbox (id, evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
      [id, nombreEvento, JSON.stringify(payload), correlationId || null],
    );
  }
}

module.exports = { OutboxMySQLPublisher };
