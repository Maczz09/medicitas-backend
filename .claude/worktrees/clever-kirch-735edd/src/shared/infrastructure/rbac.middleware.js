const { ForbiddenError, UnauthorizedError } = require('../domain/errors');

function requireRole(...nombresRoles) {
  // Acepta ambas convenciones de llamada usadas en el proyecto:
  //   requireRole('Recepcionista', 'Médico')   → rest params
  //   requireRole(['Recepcionista', 'Médico']) → un único array
  // y normaliza a mayúsculas para tolerar 'RECEPCIONISTA' vs 'Recepcionista'.
  const rolesPermitidos = nombresRoles.flat();
  const permitidosUpper = rolesPermitidos.map((r) => String(r).toUpperCase());

  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Se requiere autenticación');
      }

      // El rol INTERNAL siempre tiene acceso a todas las rutas protegidas (comunicación síncrona S2S)
      if (req.user.rolNombre === 'INTERNAL') {
        return next();
      }

      if (!permitidosUpper.includes(String(req.user.rolNombre).toUpperCase())) {
        throw new ForbiddenError(`Se requiere uno de los roles: ${rolesPermitidos.join(', ')}`);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireRole };
