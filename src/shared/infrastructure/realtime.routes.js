const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { verifyToken } = require('./auth.middleware');
const { client: redisClient } = require('../../config/redis');
const { rolesPermitidos } = require('./realtime.routing');

const TICKET_TTL_SEGUNDOS = 30;
const RING_SIZE = 200;

let clients = []; // { res, rolNombre }
const ringBuffer = []; // { idEvento, type, payload } — últimos eventos de ESTE worker, para resync

// Ticket de un solo uso: EventSource no permite headers custom, así que el
// JWT normal (8h) no puede viajar en la query string de /stream sin quedar
// expuesto en logs de acceso. Se cambia por un ticket UUID de vida corta,
// guardado en Redis (compartido entre workers) y consumido atómicamente
// (GETDEL) — sirve para una sola conexión y nunca más.
router.post('/ticket', verifyToken, async (req, res, next) => {
  try {
    const ticket = crypto.randomUUID();
    const datos = JSON.stringify({
      idUsuario: req.user.idUsuario || req.user.sub,
      rolNombre: req.user.rolNombre,
      idMedico: req.user.idMedico || null,
      nombre: req.user.nombre || null,
    });
    await redisClient.set(`rt:ticket:${ticket}`, datos, { EX: TICKET_TTL_SEGUNDOS });
    res.status(200).json({ ticket });
  } catch (err) {
    next(err);
  }
});

// Send keep-alive ping every 15s to prevent timeouts.
// .unref() — no debe ser una razón para mantener vivo el proceso (permite un
// shutdown limpio) ni bloquear la salida de un test runner que requiera este
// módulo (encontrado en vivo: sin esto, un test que abre/cierra un circuit
// breaker real disparaba el require lazy de este archivo desde
// circuitBreaker.js y el timer quedaba colgado entre tests del mismo worker).
setInterval(() => {
  clients.forEach(({ res }) => res.write(': ping\n\n'));
}, 15000).unref();

router.get('/stream', async (req, res, next) => {
  try {
    const ticket = req.query.ticket;
    if (!ticket) {
      return res.status(401).json({ error: 'Ticket ausente' });
    }

    const datosRaw = await redisClient.getDel(`rt:ticket:${ticket}`);
    if (!datosRaw) {
      return res.status(401).json({ error: 'Ticket inválido, expirado o ya usado' });
    }
    const { rolNombre } = JSON.parse(datosRaw);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

    // Enviar evento de conexión inicial
    res.write('data: {"type":"CONNECTED"}\n\n');

    const client = { res, rolNombre };
    clients.push(client);

    // Resync: si el cliente trae el id del último evento que vio antes de
    // reconectar, se le reenvía solo lo posterior desde el ring buffer de
    // ESTE worker. Si no está (ventana expirada, o el cliente venía de otro
    // worker en el reconnect anterior), se avisa explícitamente en vez de
    // quedarse callado — el frontend decide qué hacer con ese aviso.
    const lastEventId = req.query.lastEventId;
    if (lastEventId) {
      const idx = ringBuffer.findIndex((e) => e.idEvento === lastEventId);
      if (idx === -1) {
        res.write(`data: ${JSON.stringify({ type: 'RESYNC_GAP' })}\n\n`);
      } else {
        for (const evento of ringBuffer.slice(idx + 1)) {
          enviarSiCorresponde(client, evento);
        }
      }
    }

    req.on('close', () => {
      clients = clients.filter((c) => c !== client);
    });
  } catch (err) {
    next(err);
  }
});

function rolPermiteEvento(rolNombreCliente, tipoEvento) {
  if (rolNombreCliente === 'INTERNAL') return true;
  const permitidos = rolesPermitidos(tipoEvento).map((r) => r.toUpperCase());
  return permitidos.includes(String(rolNombreCliente).toUpperCase());
}

function enviarSiCorresponde(client, evento) {
  if (!rolPermiteEvento(client.rolNombre, evento.type)) return;
  const message = JSON.stringify({ type: evento.type, payload: evento.payload });
  client.res.write(`id: ${evento.idEvento}\ndata: ${message}\n\n`);
}

/**
 * Emite un evento a los clientes SSE conectados cuyo rol tenga permiso sobre
 * ese tipo de evento (ver realtime.routing.js), y lo guarda en el ring buffer
 * de este worker para poder reenviarlo si un cliente reconecta pidiendo resync.
 * @param {string} type - Tipo de evento
 * @param {object} payload - El sobre completo del evento (incluye payload.idEvento)
 */
function broadcastEvent(type, payload) {
  const idEvento = (payload && payload.idEvento) || crypto.randomUUID();
  const evento = { idEvento, type, payload };

  ringBuffer.push(evento);
  if (ringBuffer.length > RING_SIZE) ringBuffer.shift();

  clients.forEach((client) => enviarSiCorresponde(client, evento));
}

/**
 * Emite un evento operativo (circuit breaker, kill-switch) por el mismo canal
 * SSE que los eventos de dominio — pero SIN pasar por Outbox/RabbitMQ, a
 * propósito: son señales efímeras de infraestructura de ESTE worker/proceso
 * (o ya sincronizadas por otro medio, ver serviceSwitch.js), no hechos de
 * negocio que necesiten durabilidad ni reconstrucción histórica. Arma el
 * mismo sobre que ya usa publishEvent() en config/rabbitmq.js para que el
 * frontend no necesite ningún caso especial de parseo.
 * @param {string} tipo - ej. 'CircuitBreakerAbierto', 'ServicioDeshabilitado'
 * @param {object} payload
 */
function emitirEventoOperacional(tipo, payload) {
  broadcastEvent(tipo, {
    evento: tipo,
    idEvento: crypto.randomUUID(),
    origen: 'resiliencia',
    payload,
    correlationId: null,
    timestamp: new Date().toISOString(),
    actor: null,
  });
}

module.exports = {
  realtimeRouter: router,
  broadcastEvent,
  emitirEventoOperacional,
};
