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

    // Auditoria
    await channel.assertQueue('q.auditoria.dlq', { durable: true });
    await channel.assertQueue('q.auditoria', {
      durable: true,
      arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'q.auditoria.dlq' }
    });
    await channel.bindQueue('q.auditoria', 'medicitas.events', '#');

    // Notificaciones
    await channel.assertQueue('q.notificaciones.dlq', { durable: true });
    await channel.assertQueue('q.notificaciones', {
      durable: true,
      arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'q.notificaciones.dlq' }
    });
    await channel.bindQueue('q.notificaciones', 'medicitas.events', 'citas.*');
    await channel.bindQueue('q.notificaciones', 'medicitas.events', 'pagos.PagoAprobado');
    await channel.bindQueue('q.notificaciones', 'medicitas.events', 'facturacion.ComprobanteEmitido');

    // Prescripciones
    await channel.assertQueue('q.prescripciones.dlq', { durable: true });
    await channel.assertQueue('q.prescripciones', {
      durable: true,
      arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'q.prescripciones.dlq' }
    });
    await channel.bindQueue('q.prescripciones', 'medicitas.events', 'event.PrescripcionEmitida');

    console.log('[RabbitMQ] Conectado exitosamente y Exchange declarado');
  } catch (err) {
    console.error('[RabbitMQ] Error de conexión:', err);
    throw err;
  }
}

async function publishEvent(tipoEvento, payload, correlationId, idEvento, origen) {
  if (!channel) throw new Error('Canal de RabbitMQ no inicializado');

  const routingKey = `event.${tipoEvento}`;
  const id = idEvento || require('uuid').v4();

  // Los consumidores esperan un sobre { evento, idEvento, origen, payload, correlationId },
  // no solo el payload. Sin esto, todos descartan el mensaje (Auditoría exige `origen`).
  const sobre = { evento: tipoEvento, idEvento: id, origen: origen || 'desconocido', payload, correlationId };
  const message = Buffer.from(JSON.stringify(sobre));

  channel.publish('medicitas.events', routingKey, message, {
    persistent: true,
    messageId: id,
    correlationId: correlationId,
    contentType: 'application/json'
  });
}

function getChannel() {
  return channel;
}

module.exports = { connect, publishEvent, getChannel };
