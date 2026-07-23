const router = require('express').Router();
const { verifyToken } = require('./auth.middleware');
const { requireRole } = require('./rbac.middleware');
const { listarCircuitosAbiertos } = require('../resilience/circuitBreaker');

/**
 * @swagger
 * /api/v2/admin/circuitos:
 *   get:
 *     summary: Circuit breakers abiertos ahora mismo (snapshot, no en vivo)
 *     description: >
 *       El frontend lo usa para sincronizar el ResilienceBanner al cargar o
 *       recargar la página — el canal SSE (CircuitBreakerAbierto/Cerrado)
 *       solo informa transiciones vistas en vivo DESPUÉS de conectarse; sin
 *       este snapshot, un circuito ya abierto antes del F5 quedaba invisible
 *       hasta la siguiente transición real.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', verifyToken, requireRole('Recepcionista', 'Médico', 'Auditor'), (req, res) => {
  res.json({
    data: listarCircuitosAbiertos(),
    correlationId: req.correlationId,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
