const { DomainError } = require('../domain/errors');
const logger = require('../logger/logger');

/**
 * Manejador de errores global. Responde SIEMPRE con el envelope estándar:
 *   { codigo, mensaje, detalles?, correlationId, timestamp }
 *
 * - `detalles` solo aparece en errores de validación (array de { campo, mensaje }).
 * - Los errores 500 no controlados NUNCA exponen err.message, stack, SQL ni
 *   rutas internas al cliente — se loguea el detalle completo del lado servidor
 *   (con correlationId para poder cruzarlo) y al cliente se le da un mensaje genérico.
 */
function errorHandler(err, req, res, next) {
  let status = 500;
  let codigo = 'ERROR_INTERNO';
  let mensaje = 'Error interno del servidor';
  let detalles;

  if (err instanceof DomainError) {
    status = err.status;
    codigo = err.codigo;
    mensaje = err.message;
    if (err.detalles) detalles = err.detalles;
    if (err.meta) detalles = detalles || err.meta;
  } else if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    // JSON malformado interceptado por express.json() — 400 sin filtrar el
    // detalle interno del parser (evita revelar posición/estructura al cliente).
    status = 400;
    codigo = 'JSON_MALFORMADO';
    mensaje = 'El cuerpo de la petición no es un JSON válido.';
  } else if (err.status && Number.isInteger(err.status)) {
    status = err.status;
    codigo = err.codigo || codigo;
    mensaje = err.message || mensaje;
  }

  // Red de seguridad: si el status no es un entero HTTP válido, usar 500.
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    status = 500;
  }

  // Log del lado servidor: los 5xx son fallas reales (nivel error con stack);
  // los 4xx son esperables (nivel warn, sin stack ruidoso).
  if (status >= 500) {
    logger.error(
      { codigo, err: err.message, stack: err.stack, ruta: req.originalUrl, metodo: req.method, correlationId: req.correlationId },
      'Error no controlado en la petición'
    );
  } else {
    logger.warn(
      { codigo, mensaje, ruta: req.originalUrl, metodo: req.method, correlationId: req.correlationId },
      'Petición rechazada'
    );
  }

  return res.status(status).json({
    codigo,
    mensaje,
    ...(detalles && { detalles }),
    correlationId: req.correlationId || null,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { errorHandler };
