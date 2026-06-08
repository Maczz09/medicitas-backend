async function publicarEventoOutbox(conn, schema, { idEvento, tipoEvento, payload, correlationId }) {
  await conn.query(
    `INSERT INTO ${schema}.outbox (id_evento, tipo_evento, payload, correlation_id)
     VALUES (?, ?, ?, ?)`,
    [idEvento, tipoEvento, JSON.stringify(payload), correlationId]
  );
}

module.exports = { publicarEventoOutbox };
