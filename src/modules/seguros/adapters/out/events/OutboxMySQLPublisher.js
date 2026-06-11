const { v4: uuidv4 } = require('uuid');
const logger = require('../../../../../shared/logger/logger');

class OutboxMySQLPublisher {
  async publish(connection, evento, payload, correlationId) {
    const id = uuidv4();
    const payloadString = JSON.stringify(payload);
    
    try {
      await connection.execute(
        `INSERT INTO svc_seg.outbox (id, evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
        [id, evento, payloadString, correlationId]
      );
      logger.info({ id, evento, correlationId }, 'Evento guardado en Outbox (Seguros)');
    } catch (error) {
      logger.error({ error, evento, correlationId }, 'Error al guardar evento en Outbox (Seguros)');
      throw error;
    }
  }
}

module.exports = { OutboxMySQLPublisher };
