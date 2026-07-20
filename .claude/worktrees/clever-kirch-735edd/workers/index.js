require('dotenv').config();
const database = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');

async function startWorkers() {
  await database.query('SELECT 1');
  await rabbitmq.connect();

  require('./outbox.worker');
  require('./tolerancia.cron');

  // Registrar Jobs de Citas (SVC-CIT-001)
  require('../src/modules/citas/jobs/cacheSyncJob');
  require('../src/modules/citas/jobs/toleranceWorker');

  const { startConsumers } = require('../src/modules/notificaciones/workers/notificaciones.consumer');
  await startConsumers();
  
  console.log('[Workers] Todos los workers iniciados correctamente.');
}

startWorkers().catch(console.error);
