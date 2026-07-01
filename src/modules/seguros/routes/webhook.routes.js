const express = require('express');
const { WebhookController } = require('../adapters/in/WebhookController');
const { ProcesarWebhookAseguradoraUseCase } = require('../application/use-cases/ProcesarWebhookAseguradoraUseCase');
const { CoberturasMySQLRepository } = require('../adapters/out/repositories/CoberturasMySQLRepository');
const { OutboxMySQLPublisher } = require('../adapters/out/events/OutboxMySQLPublisher');
const dbPool = require('../../../config/database');

// Wiring local para el webhook
const coberturaRepo = new CoberturasMySQLRepository(dbPool);
const eventPublisher = new OutboxMySQLPublisher();
const getConnection = async () => await dbPool.getConnection();

const procesarWebhookUseCase = new ProcesarWebhookAseguradoraUseCase({
  coberturaRepository: coberturaRepo,
  eventPublisher,
  getConnection
});

const controller = new WebhookController({ procesarWebhookUseCase });

const router = express.Router();

// Usaremos un middleware de API Key simple (compartido entre los microservicios)
const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.API_KEY || 'test-api-key-12345';
  
  if (apiKey !== validKey) {
    return res.status(401).json({ codigo: 'UNAUTHORIZED', mensaje: 'API Key inválida' });
  }
  next();
};

/**
 * @swagger
 * /api/v1/webhooks/seguros:
 *   post:
 *     summary: Webhook de Aseguradora (Actualización de póliza)
 *     description: Recibe el cambio de estado de una póliza desde la aseguradora para sincronizar internamente la base de datos de coberturas. Requiere X-Api-Key.
 *     tags: [Webhooks]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - numeroPoliza
 *               - estado
 *             properties:
 *               numeroPoliza:
 *                 type: string
 *               estado:
 *                 type: string
 *                 enum: [VIGENTE, SUSPENDIDA, CANCELADA]
 *     responses:
 *       200:
 *         description: Estado actualizado exitosamente en el sistema de MediCitas
 *       401:
 *         description: API Key inválida
 *       500:
 *         description: Error interno del servidor
 */
router.post(
  '/',
  verifyApiKey,
  controller.recibirWebhook
);

module.exports = router;
