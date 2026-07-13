require('dotenv').config();
const database = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');

async function startWorkers() {
  await database.query('SELECT 1');
  await rabbitmq.connect();

  require('./outbox.worker');
  require('./tolerancia.cron');
  require('./limpieza_idempotencia.cron');

  // Registrar Jobs de Citas (SVC-CIT-001)
  require('../src/modules/citas/jobs/cacheSyncJob');
  require('../src/modules/citas/jobs/toleranceWorker');

  // Nota: el consumer de notificaciones NO corre aquí — el real vive en
  // server.js (NotificacionesConsumer). El antiguo consumer de este directorio
  // era código muerto (mandaba emails falsos) y se eliminó.

  console.log('[Workers] Todos los workers iniciados correctamente.');
}

startWorkers().catch(console.error);
