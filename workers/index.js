require('dotenv').config();
const database = require('../src/config/database');
const rabbitmq = require('../src/config/rabbitmq');

async function startWorkers() {
  await database.query('SELECT 1');
  await rabbitmq.connect();

  require('./outbox.worker');
  require('./tolerancia.cron');

  const { startConsumers } = require('../src/modules/notificaciones/workers/notificaciones.consumer');
  await startConsumers();
  
  console.log('[Workers] Todos los workers iniciados correctamente.');
}

startWorkers().catch(console.error);
