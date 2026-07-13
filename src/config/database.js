const mysql = require('mysql2/promise');

// El tamaño del pool es configurable por env para las pruebas de carga.
// Default 10 = comportamiento histórico (sin cambios en producción).
//
// REGLA DE ORO (aprendida en carga — no la rompas): con clustering, CADA worker
// crea su propio pool, así que el total de conexiones a MySQL es
//   WEB_CONCURRENCY × DB_POOL_SIZE
// y debe rondar 3-4× los cores, NO saturar. Con 10 workers × 20 = 200 conexiones,
// MySQL quedaba a 800% CPU haciendo thrashing (~200 queries a la vez) y el
// throughput COLAPSABA (el 1er 500k se estancó en 141k). Además debe quedar por
// debajo de `max_connections` (151 por defecto; el override de carga lo sube a
// 500). Defaults de carga balanceados: 6 workers × 8 = 48. Ver
// docker-compose.loadtest.yml.
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
