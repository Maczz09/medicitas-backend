const logger = require('../logger/logger');

// Logger de ACCESO: registra CADA petición HTTP al terminar la respuesta
// (método, ruta, status, duración, correlationId) → en Grafana Loki se ve TODO
// el tráfico, no solo los errores. Cada línea comparte el correlationId con el
// resto de logs de esa petición, así se rastrea el flujo completo.
//
// Precedencia: LOG_HTTP gana siempre; si no está, LOAD_TEST_MODE=true lo apaga.
// docker-compose.loadtest.yml setea LOG_HTTP=true, así que EN CARGA TAMBIÉN SE
// LOGUEA: el apagado automático dejaba las pruebas k6 sin una sola petición en
// Loki, que es precisamente la evidencia de observabilidad que hay que mostrar.
// El apagado sigue disponible (LOG_HTTP=false) para corridas de volumen extremo
// donde >1000 líneas/s retrasan la ingesta de Loki.
const HABILITADO =
  process.env.LOG_HTTP === 'true' ||
  (process.env.LOG_HTTP !== 'false' && process.env.LOAD_TEST_MODE !== 'true');

// Endpoints de infraestructura que se golpean solos (healthcheck cada 15s,
// scrape de métricas) — se omiten para no ensuciar el log de acceso.
const OMITIR = new Set(['/health', '/metrics']);

function httpLogger(req, res, next) {
  if (!HABILITADO || OMITIR.has(req.path)) return next();

  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    const datos = {
      metodo: req.method,
      ruta: req.originalUrl,
      status: res.statusCode,
      durationMs,
      correlationId: req.correlationId,
    };
    const msg = `${req.method} ${req.originalUrl} → ${res.statusCode} (${durationMs}ms)`;
    if (res.statusCode >= 500) logger.error(datos, msg);
    else if (res.statusCode >= 400) logger.warn(datos, msg);
    else logger.info(datos, msg);
  });

  next();
}

module.exports = { httpLogger };
