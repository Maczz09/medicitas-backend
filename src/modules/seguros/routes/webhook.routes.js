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

router.post(
  '/',
  verifyApiKey,
  controller.recibirWebhook
);

module.exports = router;
