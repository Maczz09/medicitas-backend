const { estaHabilitado } = require('./serviceSwitch');

/**
 * Responde 503 en vez de dejar pasar la petición si el módulo fue
 * deshabilitado vía PATCH /api/v2/admin/servicios/:nombre — simula la caída
 * de ese servicio dentro del monolito sin tocar los demás módulos.
 */
function killSwitch(nombre) {
  return (req, res, next) => {
    if (!estaHabilitado(nombre)) {
      return res.status(503).json({
        codigo: 'SERVICIO_NO_DISPONIBLE',
        mensaje: `El servicio de ${nombre} no está disponible temporalmente.`,
        correlationId: req.correlationId || null,
        timestamp: new Date().toISOString(),
      });
    }
    next();
  };
}

module.exports = { killSwitch };
