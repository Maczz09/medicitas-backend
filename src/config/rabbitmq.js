const amqp = require('amqplib');

let connection = null;
let channel = null;
let _reconnecting = false;
let _onReconnectCallbacks = [];

function registrarOnReconnect(fn) {
  _onReconnectCallbacks.push(fn);
}

async function connect() {
  const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  connection = await amqp.connect(url);
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
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.CitaCreada');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.CitaCancelada');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.CitaReprogramada');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.PagoAprobado');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.ComprobanteEmitido');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.Recordatorio30m');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.AlertaRetraso');
  await channel.bindQueue('q.notificaciones', 'medicitas.events', 'event.CitaExpirada');

  // Prescripciones
  await channel.assertQueue('q.prescripciones.dlq', { durable: true });
  await channel.assertQueue('q.prescripciones', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'q.prescripciones.dlq' }
  });
  await channel.bindQueue('q.prescripciones', 'medicitas.events', 'event.PrescripcionEmitida');

  // Reconexión automática si la conexión se cierra
  connection.on('close', () => {
    console.warn('[RabbitMQ] Conexión cerrada — intentando reconectar en 5s...');
    channel = null;
    connection = null;
    _scheduleReconnect();
  });
  connection.on('error', (err) => {
    console.error('[RabbitMQ] Error en conexión:', err.message);
  });

  console.log('[RabbitMQ] Conectado exitosamente y Exchange declarado');
}

async function _scheduleReconnect() {
  if (_reconnecting) return;
  _reconnecting = true;
  let delay = 3000;
  while (!channel) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30000);
    try {
      await connect();
      console.log('[RabbitMQ] Reconexión exitosa — re-registrando consumers...');
      for (const fn of _onReconnectCallbacks) {
        try { await fn(channel); } catch (e) { console.error('[RabbitMQ] Error en callback de reconexión:', e.message); }
      }
    } catch (err) {
      console.error(`[RabbitMQ] Reconexión fallida, reintentando en ${delay}ms:`, err.message);
      channel = null;
      connection = null;
    }
  }
  _reconnecting = false;
}

async function publishEvent(tipoEvento, payload, correlationId, idEvento, origen) {
  if (!channel) throw new Error('Canal de RabbitMQ no inicializado');

  const routingKey = `event.${tipoEvento}`;
  const id = idEvento || require('uuid').v4();

  let parsedPayload;
  try {
    parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
  } catch {
    parsedPayload = {};
  }

  const { _actor, _timestamp, ...cleanPayload } = parsedPayload;

  const sobre = {
    evento:        tipoEvento,
    idEvento:      id,
    origen:        origen || 'desconocido',
    payload:       cleanPayload,
    correlationId,
    timestamp:     _timestamp || new Date().toISOString(),
    actor:         _actor || null,
  };
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

module.exports = { connect, publishEvent, getChannel, registrarOnReconnect };
