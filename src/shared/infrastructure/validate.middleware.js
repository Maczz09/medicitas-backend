'use strict';

const { DomainError } = require('../domain/errors');

/**
 * Middleware factory de validación con Zod.
 *
 * Valida `req[source]` (body por defecto) contra un schema Zod. Si falla,
 * lanza un DomainError 400 con `detalles`: un array de { campo, mensaje } por
 * cada regla violada — el error handler global lo incluye en el envelope, así
 * el cliente recibe exactamente QUÉ campo falló y POR QUÉ, nunca un 500.
 *
 * Además, reemplaza req[source] con el objeto ya parseado (coerciones y
 * defaults de Zod aplicados), de modo que el controlador recibe datos limpios.
 *
 * Uso:
 *   router.post('/', verifyToken, validate(crearCitaSchema), controller.crear);
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const detalles = result.error.issues.map((i) => ({
        campo: i.path.join('.') || '(raíz)',
        mensaje: i.message,
      }));
      return next(new DomainError('VALIDACION_FALLIDA', 400, 'Uno o más campos son inválidos.', detalles));
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
