const { Router } = require('express');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');

const { TrazasMySQLRepository }          = require('../adapters/out/repositories/TrazasMySQLRepository');
const { ConsultarTrazasUseCase }         = require('../application/use-cases/ConsultarTrazasUseCase');
const { ReconstruirCorrelacionUseCase }  = require('../application/use-cases/ReconstruirCorrelacionUseCase');
const { AuditoriaController }            = require('../adapters/in/AuditoriaController');
const dbPool = require('../../../config/database');

const repo = new TrazasMySQLRepository(dbPool);

const controller = new AuditoriaController({
  consultarTrazasUseCase:        new ConsultarTrazasUseCase({ trazasRepository: repo }),
  reconstruirCorrelacionUseCase: new ReconstruirCorrelacionUseCase({ trazasRepository: repo }),
});

const router = Router();

/**
 * @swagger
 * /api/v1/auditoria/trazas:
 *   get:
 *     summary: Consultar trazas con filtros
 *     tags: [Auditoria]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: servicio
 *         schema:
 *           type: string
 *       - in: query
 *         name: tipoEvento
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de trazas
 */
router.get('/trazas', verifyToken, requireRole(['AUDITOR','INTERNAL']), controller.consultarTrazas);

/**
 * @swagger
 * /api/v1/auditoria/correlacion/{correlationId}:
 *   get:
 *     summary: Reconstruir flujo completo por correlationId
 *     tags: [Auditoria]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: correlationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Historial de la operación
 */
router.get('/correlacion/:correlationId', verifyToken, requireRole(['AUDITOR','INTERNAL']), controller.consultarCorrelacion);

module.exports = router;
