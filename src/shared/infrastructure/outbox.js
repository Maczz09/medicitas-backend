const asyncContext = require('../logger/asyncContext');

async function publicarEventoOutbox(conn, schema, { idEvento, tipoEvento, payload, correlationId }) {
  // Leer identidad del actor desde el contexto async (inyectado por verifyToken).
  // En procesos internos/workers el store no existe, así que los campos quedan null.
  const store = asyncContext.getStore?.() || null;
  const actor = {
    id:     store?.get('actorId')     || null,
    nombre: store?.get('actorNombre') || null,
    rol:    store?.get('actorRol')    || null,
  };

  // _actor y _timestamp se incrusta en el payload para sobrevivir el viaje outbox→RabbitMQ.
  // publishEvent los extrae y los sube al sobre del mensaje antes de enviar.
  const payloadConMeta = { ...payload, _actor: actor, _timestamp: new Date().toISOString() };

  await conn.query(
    `INSERT INTO ${schema}.outbox (id_evento, tipo_evento, payload, correlation_id)
     VALUES (?, ?, ?, ?)`,
    [idEvento, tipoEvento, JSON.stringify(payloadConMeta), correlationId]
  );
}

module.exports = { publicarEventoOutbox };
