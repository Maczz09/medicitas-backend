const { IEventPublisher } = require('../../../ports/out');
const { v4: uuidv4 } = require('uuid');
const { capturarTraceMeta } = require('../../../../../shared/infrastructure/traceContext');

// Mismo patrón que citas/prescripciones: publish(connection,...) usa la
// conexión de la transacción que llama — atómico con el cambio de datos que
// lo origina. A diferencia de medicos.usecases.js#_emit (que abre su propia
// conexión aparte y traga errores con console.warn), un fallo aquí revierte
// la transacción completa, y el evento nunca se separa del cambio real.
class OutboxMySQLPublisher extends IEventPublisher {
  async publish(connection, nombreEvento, payload, correlationId) {
    const id = uuidv4();
    // _traceparent viaja dentro del payload — une la traza end-to-end (ver traceContext.js)
    await connection.execute(
      `INSERT INTO svc_hor.outbox (id_evento, tipo_evento, payload, correlation_id) VALUES (?, ?, ?, ?)`,
      [id, nombreEvento, JSON.stringify({ ...payload, ...capturarTraceMeta() }), correlationId || null],
    );
  }
}

module.exports = { OutboxMySQLPublisher };
