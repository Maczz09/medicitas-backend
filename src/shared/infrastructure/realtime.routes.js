const express = require('express');
const router = express.Router();

let clients = [];

// Send keep-alive ping every 15s to prevent timeouts
setInterval(() => {
  clients.forEach(client => client.write(': ping\n\n'));
}, 15000);

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

  // Enviar evento de conexión inicial
  res.write('data: {"type":"CONNECTED"}\n\n');

  clients.push(res);

  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

/**
 * Función para emitir un evento a todos los clientes SSE conectados.
 * @param {string} type - Tipo de evento
 * @param {object} payload - Datos del evento
 */
function broadcastEvent(type, payload) {
  const message = JSON.stringify({ type, payload });
  clients.forEach(client => {
    client.write(`data: ${message}\n\n`);
  });
}

module.exports = {
  realtimeRouter: router,
  broadcastEvent
};
