require('dotenv').config();
const app = require('./app');
const database = require('./config/database');
const redis = require('./config/redis');
const rabbitmq = require('./config/rabbitmq');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await database.query('SELECT 1');
    console.log('[MySQL] Conectado exitosamente');

    await redis.connect();
    await rabbitmq.connect();

    app.listen(PORT, () => {
      console.log(`[Servidor] Escuchando en el puerto ${PORT} - Entorno: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('[Bootstrap] Error crítico al iniciar:', err);
    process.exit(1);
  }
}

bootstrap();
