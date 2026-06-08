const jwt = require('jsonwebtoken');
const { UnauthorizedError } = require('../domain/errors');

function verifyToken(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Token JWT ausente o mal formado'));
  }

  const token = header.split(' ')[1];

  // Interceptar llamadas internas con el token estático
  console.log('DEBUG AUTH:', { token, envToken: process.env.INTERNAL_SERVICE_TOKEN });
  if (process.env.INTERNAL_SERVICE_TOKEN && token === process.env.INTERNAL_SERVICE_TOKEN.trim()) {
    req.user = { sub: 'internal_service', rolNombre: 'INTERNAL' };
    return next();
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return next(new UnauthorizedError('Token expirado o inválido'));
  }
}

module.exports = { verifyToken };
