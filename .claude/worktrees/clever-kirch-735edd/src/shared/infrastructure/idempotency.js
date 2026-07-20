const db = require('../../config/database');

async function esEventoYaProcesado(schema, idEvento, consumidor) {
  const [rows] = await db.query(
    `SELECT 1 FROM ${schema}.eventos_procesados WHERE id_evento = ? AND consumidor = ?`,
    [idEvento, consumidor]
  );
  return rows.length > 0;
}

async function marcarEventoProcesado(conn, schema, idEvento, tipoEvento, consumidor) {
  await conn.query(
    `INSERT IGNORE INTO ${schema}.eventos_procesados (id_evento, tipo_evento, consumidor)
     VALUES (?, ?, ?)`,
    [idEvento, tipoEvento, consumidor]
  );
}

module.exports = { esEventoYaProcesado, marcarEventoProcesado };
