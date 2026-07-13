'use strict';

// Servidor de métricas de Prometheus en un puerto dedicado (9091 por defecto),
// separado del HTTP de la app (3000).
//
// POR QUÉ: en modo cluster cada worker tiene su PROPIO registro de prom-client.
// Si Prometheus scrapea backend:3000/metrics, el balanceo lo manda a UN worker
// al azar → ve solo las métricas de ESE worker (las de negocio, dispersas entre
// los 6, o las del worker de fondo #1, aparecen en 0 o subcontadas). Eso rompe
// la observabilidad justo bajo carga.
//
// SOLUCIÓN: el proceso PRIMARY expone un endpoint que AGREGA (vía IPC) las
// métricas de todos los workers con AggregatorRegistry → Prometheus ve la SUMA
// real. En modo normal (proceso único) se sirve el registro local tal cual.
//
// Prometheus scrapea backend:9091/metrics en ambos modos (ver monitoring/
// prometheus.yml). El /metrics de la app en :3000 se mantiene por compatibilidad.

const http = require('http');
const client = require('prom-client');

const PORT = parseInt(process.env.METRICS_PORT || '9091', 10);

function _serve(handler) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' || req.url === '/') {
      try {
        const { body, contentType } = await handler();
        res.setHeader('Content-Type', contentType);
        res.end(body);
      } catch (err) {
        res.statusCode = 500;
        res.end(err.message);
      }
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.on('error', (err) => console.error(`[Metrics] Error en servidor :${PORT}:`, err.message));
  server.listen(PORT);
  return server;
}

// WORKER (cluster): registra el listener IPC que responde al primary con las
// métricas de ESTE worker. CLAVE: por defecto prom-client agrega el registro
// GLOBAL, pero la app usa un registro PERSONALIZADO (config/metrics.js) — hay
// que apuntarlo con setRegistries o el primary recibiría métricas vacías.
// Construir un AggregatorRegistry en el worker dispara addListeners() (que en
// un worker registra el process.on('message') de respuesta).
function registerWorker() {
  const { register } = require('./metrics');
  client.AggregatorRegistry.setRegistries(register);
  new client.AggregatorRegistry(); // side-effect: addListeners() del lado worker
  console.log('[Metrics] Worker registrado para agregación de cluster');
}

// PRIMARY (cluster): agrega las métricas de TODOS los workers.
function startAggregated() {
  const aggregator = new client.AggregatorRegistry();
  console.log(`[Metrics] Servidor AGREGADO (cluster) escuchando en :${PORT}/metrics`);
  return _serve(async () => ({
    body: await aggregator.clusterMetrics(),
    contentType: aggregator.contentType,
  }));
}

// Proceso ÚNICO (modo normal): sirve el registro local.
function startLocal() {
  const { register } = require('./metrics');
  console.log(`[Metrics] Servidor LOCAL escuchando en :${PORT}/metrics`);
  return _serve(async () => ({
    body: await register.metrics(),
    contentType: register.contentType,
  }));
}

module.exports = { startAggregated, startLocal, registerWorker };
