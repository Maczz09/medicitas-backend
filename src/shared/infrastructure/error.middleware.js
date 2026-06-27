const { DomainError } = require('../domain/errors');

function errorHandler(err, req, res, next) {
  console.error(`[ERROR] correlationId=${req.correlationId}`, err);

  let status = 500;
  let codigo = 'ERROR_INTERNO';
  let mensaje = 'Error interno del servidor';

  if (err instanceof DomainError) {
    status = err.status;
    codigo = err.codigo;
    mensaje = err.message;
  } else if (err.status) {
    status = err.status;
    codigo = err.codigo || codigo;
    mensaje = err.message || mensaje;
  }

  // Red de seguridad: si el status no es un entero HTTP válido, usar 500.
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    status = 500;
  }

  const meta = (err instanceof DomainError && err.meta) ? err.meta : undefined;

  return res.status(status).json({
    codigo,
    mensaje,
    ...(meta && { meta }),
    correlationId: req.correlationId
  });
}

module.exports = { errorHandler };
