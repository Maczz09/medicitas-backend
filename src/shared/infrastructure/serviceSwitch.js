// Kill-switch de módulos para simular la caída de un servicio dentro del
// monolito (demostración de resiliencia: el resto del sistema sigue
// funcionando aunque un módulo esté "de baja"). Se activa/desactiva en
// caliente vía PATCH /api/v2/admin/servicios/:nombre, sin reiniciar.
//
// Respaldado en Redis para que funcione con CLUSTERING: con varios workers,
// un PATCH lo atiende UN solo worker; sin Redis, los demás workers no se
// enterarían y el kill-switch quedaría inconsistente. Diseño:
//   - Cada worker mantiene una CACHÉ LOCAL (Map) para que estaHabilitado()
//     siga siendo SÍNCRONO (lo exige killSwitch.middleware.js).
//   - establecer() actualiza la caché local al instante y propaga a Redis
//     (SET + PUBLISH) best-effort; los demás workers reciben el cambio por
//     un suscriptor pub/sub y actualizan su caché en milisegundos.
//   - init() carga el estado inicial y arranca el suscriptor. Debe llamarse
//     en CADA worker tras redis.connect().
//   - Si Redis no está disponible, degrada a memoria por proceso (como antes).

const { client } = require('../../config/redis');

const PREFIX = 'svc:switch:';
const CHANNEL = 'svc:switch:changed';

const cache = new Map(); // nombre -> boolean (habilitado)
let subscriber = null;

function estaHabilitado(nombre) {
  return cache.get(nombre) !== false; // habilitado por defecto si nunca se tocó
}

function establecer(nombre, habilitado) {
  const val = !!habilitado;
  cache.set(nombre, val); // inmediato para este worker

  // Propagar a Redis y a los demás workers (no bloquea la respuesta HTTP).
  Promise.resolve()
    .then(async () => {
      if (!client.isOpen) return;
      await client.set(PREFIX + nombre, val ? '1' : '0');
      await client.publish(CHANNEL, JSON.stringify({ nombre, habilitado: val }));
    })
    .catch((e) => {
      const logger = require('../logger/logger');
      logger.warn({ err: e.message, nombre }, '[serviceSwitch] no se pudo propagar a Redis — queda local en este worker');
    });
}

async function init() {
  const logger = require('../logger/logger');
  try {
    if (!client.isOpen) {
      logger.warn('[serviceSwitch] Redis no conectado — kill-switch en modo memoria (por proceso)');
      return;
    }

    // Estado inicial desde Redis (típicamente pocas claves).
    const keys = await client.keys(PREFIX + '*');
    for (const k of keys) {
      const v = await client.get(k);
      cache.set(k.slice(PREFIX.length), v !== '0');
    }

    // Suscriptor dedicado (node-redis exige una conexión aparte para pub/sub).
    subscriber = client.duplicate();
    subscriber.on('error', (err) => logger.warn({ err: err.message }, '[serviceSwitch] error en suscriptor Redis'));
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL, (message) => {
      try {
        const { nombre, habilitado } = JSON.parse(message);
        cache.set(nombre, !!habilitado);
      } catch { /* mensaje malformado — ignorar */ }
    });

    logger.info({ estados: Object.fromEntries(cache) }, '[serviceSwitch] sincronizado con Redis (pub/sub activo)');
  } catch (e) {
    logger.warn({ err: e.message }, '[serviceSwitch] init con Redis falló — modo memoria');
  }
}

module.exports = { estaHabilitado, establecer, init };
