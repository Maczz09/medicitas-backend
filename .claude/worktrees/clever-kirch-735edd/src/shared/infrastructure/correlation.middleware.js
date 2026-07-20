const { v4: uuidv4 } = require('uuid');
const { trace } = require('@opentelemetry/api');
const asyncContext = require('../logger/asyncContext');

function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  // Adjunta correlationId al span activo (creado por la auto-instrumentación
  // HTTP de OpenTelemetry) para cruzar trazas de Jaeger con logs de Loki.
  trace.getActiveSpan()?.setAttribute('correlationId', correlationId);

  asyncContext.run(new Map([['correlationId', correlationId]]), () => {
    next();
  });
}

module.exports = { correlationMiddleware };
