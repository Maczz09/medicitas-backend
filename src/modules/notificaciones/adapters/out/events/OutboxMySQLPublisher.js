const { DomainError } = require('../../../../../shared/domain/errors');

class OutboxMySQLPublisher {
  async publish(connection, evento, payload, correlationId) {
    try {
      const id = require('crypto').randomUUID();
      await connection.execute(
        `INSERT INTO svc_not.outbox (id, evento, payload, correlation_id)
         VALUES (?, ?, ?, ?)`,
        [id, evento, JSON.stringify(payload), correlationId]
      );
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al publicar evento en Outbox Notificaciones');
    }
  }
}

module.exports = { OutboxMySQLPublisher };
