const { httpRequestDuration, httpRequestTotal, httpRequestErrors, activeConnections } = require('../../config/metrics');

function normalizeRoute(req) {
  // Usa la ruta parametrizada de Express si está disponible, sino la URL limpia
  if (req.route) {
    const baseUrl = req.baseUrl || '';
    return baseUrl + req.route.path;
  }
  // Limpia IDs numéricos y UUIDs de la URL para evitar cardinalidad alta
  return req.path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') return next();

  const start = process.hrtime.bigint();
  activeConnections.inc();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e9;
    const route = normalizeRoute(req);
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestDuration.observe(labels, durationMs);
    httpRequestTotal.inc(labels);

    if (res.statusCode >= 400) {
      httpRequestErrors.inc(labels);
    }

    activeConnections.dec();
  });

  next();
}

module.exports = { metricsMiddleware };
