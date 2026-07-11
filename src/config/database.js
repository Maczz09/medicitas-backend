const mysql = require('mysql2/promise');

// El tamaño del pool es configurable por env para las pruebas de carga.
// Default 10 = comportamiento histórico (sin cambios en producción).
// OJO con el clustering: cada worker crea SU PROPIO pool, así que el total
// de conexiones a MySQL es (nº de workers × DB_POOL_SIZE) y debe quedar por
// debajo de `max_connections` de MySQL (151 por defecto; el override de
// carga lo sube). Ver docker-compose.loadtest.yml.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '10'),
  queueLimit: 0,
});

module.exports = pool;
