const jwt = require('jsonwebtoken');
const { UnauthorizedError } = require('../domain/errors');
const asyncContext = require('../logger/asyncContext');

function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Token JWT ausente o mal formado'));
  }

  const token = header.split(' ')[1];

  if (process.env.INTERNAL_SERVICE_TOKEN && token === process.env.INTERNAL_SERVICE_TOKEN.trim()) {
    req.user = { sub: 'internal_service', rolNombre: 'INTERNAL' };
    return next();
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);

    // Inyectamos la identidad del actor en el contexto async (ya creado por correlationMiddleware)
    // para que publicarEventoOutbox pueda leerla sin recibirla como parámetro explícito.
    const store = asyncContext.getStore();
    if (store && req.user) {
      store.set('actorId',     req.user.sub      || req.user.idUsuario || null);
      store.set('actorNombre', req.user.nombre   || req.user.email    || null);
      store.set('actorRol',    req.user.rolNombre                     || null);
    }

    next();
  } catch {
    return next(new UnauthorizedError('Token expirado o inválido'));
  }
}

module.exports = { verifyToken };
