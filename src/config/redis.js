const { createClient } = require('redis');

const host = process.env.REDIS_HOST || 'localhost';
const port = process.env.REDIS_PORT || 6379;
const password = process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : '';
const redisUrl = process.env.REDIS_URL || `redis://${password}${host}:${port}`;

const redisClient = createClient({
  url: redisUrl
});

redisClient.on('error', (err) => console.error('[Redis] Error de conexión:', err));
redisClient.on('connect', () => console.log('[Redis] Conectado exitosamente'));

async function connect() {
  await redisClient.connect();
}

module.exports = {
  client: redisClient,
  connect
};
