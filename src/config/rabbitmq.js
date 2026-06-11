const amqp = require('amqplib');

let connection = null;
let channel = null;

async function connect() {
  try {
    connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    channel = await connection.createChannel();
    
    await channel.assertExchange('medicitas.events', 'topic', { durable: true });
    
    // Facturacion
    await channel.assertQueue('q.facturacion', { durable: true });
    await channel.bindQueue('q.facturacion', 'medicitas.events', 'event.PagoAprobado');

    console.log('[RabbitMQ] Conectado exitosamente y Exchange declarado');
  } catch (err) {
    console.error('[RabbitMQ] Error de conexión:', err);
    throw err;
  }
}

async function publishEvent(tipoEvento, payload, correlationId) {
  if (!channel) throw new Error('Canal de RabbitMQ no inicializado');

  const routingKey = `event.${tipoEvento}`;
  const message = Buffer.from(JSON.stringify(payload));

  channel.publish('medicitas.events', routingKey, message, {
    persistent: true,
    messageId: require('uuid').v4(),
    correlationId: correlationId,
    contentType: 'application/json'
  });
}

function getChannel() {
  return channel;
}

module.exports = { connect, publishEvent, getChannel };
