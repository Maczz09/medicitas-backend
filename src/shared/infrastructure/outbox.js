const asyncContext = require('../logger/asyncContext');
const { capturarTraceMeta } = require('./traceContext');

async function publicarEventoOutbox(conn, schema, { idEvento, tipoEvento, payload, correlationId }) {
  // Leer identidad del actor desde el contexto async (inyectado por verifyToken).
  // En procesos internos/workers el store no existe, así que los campos quedan null.
  const store = asyncContext.getStore?.() || null;
  const actor = {
    id:     store?.get('actorId')     || null,
    nombre: store?.get('actorNombre') || null,
    rol:    store?.get('actorRol')    || null,
  };

  // _actor, _timestamp y _traceparent se incrustan en el payload para sobrevivir
  // el viaje outbox→RabbitMQ. publishEvent los extrae y los sube al sobre/headers
  // del mensaje antes de enviar (el traceparent une la traza end-to-end en Jaeger).
  const payloadConMeta = { ...payload, _actor: actor, _timestamp: new Date().toISOString(), ...capturarTraceMeta() };

  await conn.query(
    `INSERT INTO ${schema}.outbox (id_evento, tipo_evento, payload, correlation_id)
     VALUES (?, ?, ?, ?)`,
    [idEvento, tipoEvento, JSON.stringify(payloadConMeta), correlationId]
  );
}

module.exports = { publicarEventoOutbox };
