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

  return res.status(status).json({
    codigo,
    mensaje,
    correlationId: req.correlationId
  });
}

module.exports = { errorHandler };
