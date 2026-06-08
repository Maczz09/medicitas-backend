const { ForbiddenError, UnauthorizedError } = require('../domain/errors');

function requireRole(...nombresRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Se requiere autenticación');
      }

      // El rol INTERNAL siempre tiene acceso a todas las rutas protegidas (comunicación síncrona S2S)
      if (req.user.rolNombre === 'INTERNAL') {
        return next();
      }

      if (!nombresRoles.includes(req.user.rolNombre)) {
        throw new ForbiddenError(`Se requiere uno de los roles: ${nombresRoles.join(', ')}`);
      }
      
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireRole };
