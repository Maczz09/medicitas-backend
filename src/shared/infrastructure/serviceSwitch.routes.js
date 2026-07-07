const router = require('express').Router();
const { verifyToken } = require('./auth.middleware');
const { requireRole } = require('./rbac.middleware');
const { estaHabilitado, establecer } = require('./serviceSwitch');

// Módulos que se pueden simular "de baja" — lista blanca explícita para no
// permitir apagar módulos core (auth, etc.) por error o accidente.
const MODULOS_TOGGLEABLES = ['pagos'];

/**
 * @swagger
 * /api/v2/admin/servicios:
 *   get:
 *     summary: Ver el estado (habilitado/deshabilitado) de los módulos toggleables
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', verifyToken, requireRole('Auditor'), (req, res) => {
  const data = Object.fromEntries(MODULOS_TOGGLEABLES.map((m) => [m, estaHabilitado(m)]));
  res.json({ data, correlationId: req.correlationId, timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /api/v2/admin/servicios/{nombre}:
 *   patch:
 *     summary: Habilitar/deshabilitar un módulo (simula su caída dentro del monolito)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: nombre
 *         required: true
 *         schema: { type: string, enum: [pagos] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [habilitado]
 *             properties:
 *               habilitado: { type: boolean }
 *     responses:
 *       200: { description: Estado actualizado }
 *       404: { description: Módulo no reconocido o no toggleable }
 */
router.patch('/:nombre', verifyToken, requireRole('Auditor'), (req, res) => {
  const { nombre } = req.params;
  if (!MODULOS_TOGGLEABLES.includes(nombre)) {
    return res.status(404).json({
      codigo: 'MODULO_NO_TOGGLEABLE',
      mensaje: `'${nombre}' no es un módulo que se pueda deshabilitar. Disponibles: ${MODULOS_TOGGLEABLES.join(', ')}.`,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }

  const { habilitado } = req.body || {};
  establecer(nombre, habilitado);
  res.json({
    data: { nombre, habilitado: estaHabilitado(nombre) },
    correlationId: req.correlationId,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
