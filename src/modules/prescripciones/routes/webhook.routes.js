const express = require('express');

const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.API_KEY || 'test-api-key-12345'; // Asegurarse de usar la clave compartida
  if (!apiKey || apiKey !== validKey) {
    return res.status(401).json({ mensaje: 'No autorizado: API Key inválida o ausente' });
  }
  next();
};
const ProcesarWebhookFarmaciaUseCase = require('../application/use-cases/ProcesarWebhookFarmaciaUseCase');
const DespachosMySQLRepository = require('../adapters/out/DespachosMySQLRepository');
const OutboxEventPublisher = require('../adapters/out/OutboxEventPublisher');
const dbPool = require('../../../config/database');
const logger = require('../../../shared/logger/logger');

const repo = new DespachosMySQLRepository();
const eventPublisher = new OutboxEventPublisher();

const procesarWebhookFarmaciaUseCase = new ProcesarWebhookFarmaciaUseCase({
  despachosRepository: repo,
  eventPublisher,
  getConnection: async () => await dbPool.getConnection(),
  logger
});

const router = express.Router();

/**
 * @swagger
 * /api/v1/webhooks/farmacia:
 *   post:
 *     summary: Recibe notificaciones asíncronas desde la farmacia (Webhooks)
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idReceta, estado]
 *             properties:
 *               idReceta:
 *                 type: string
 *               estado:
 *                 type: string
 *                 enum: [RETIRADA, RECHAZADA, DESPACHADA]
 *               referenciaFarmacia:
 *                 type: string
 *               motivoRechazo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook procesado exitosamente
 */
router.post('/farmacia', verifyApiKey, async (req, res, next) => {
  try {
    const { idReceta, estado, referenciaFarmacia, motivoRechazo } = req.body;
    if (!idReceta || !estado) {
      return res.status(400).json({ mensaje: 'idReceta y estado son obligatorios' });
    }

    const resultado = await procesarWebhookFarmaciaUseCase.ejecutar({
      idReceta,
      estado,
      referenciaFarmacia,
      motivoRechazo,
      correlationId: req.correlationId
    });

    res.status(200).json(resultado);
  } catch (error) {
    logger.error({ error }, 'Error en endpoint webhook farmacia');
    next(error);
  }
});

module.exports = router;
