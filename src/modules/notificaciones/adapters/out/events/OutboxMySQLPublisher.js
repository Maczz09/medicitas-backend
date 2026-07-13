const { DomainError } = require('../../../../../shared/domain/errors');
const { capturarTraceMeta } = require('../../../../../shared/infrastructure/traceContext');

class OutboxMySQLPublisher {
  async publish(connection, evento, payload, correlationId) {
    try {
      const id = require('crypto').randomUUID();
      // _traceparent viaja dentro del payload — une la traza end-to-end (ver traceContext.js)
      await connection.execute(
        `INSERT INTO svc_not.outbox (id_evento, tipo_evento, payload, correlation_id)
         VALUES (?, ?, ?, ?)`,
        [id, evento, JSON.stringify({ ...payload, ...capturarTraceMeta() }), correlationId]
      );
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al publicar evento en Outbox Notificaciones');
    }
  }
}

module.exports = { OutboxMySQLPublisher };
