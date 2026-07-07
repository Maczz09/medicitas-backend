const express = require('express');
const { verifyWebhookApiKey } = require('../../../shared/infrastructure/webhooks/verifyWebhookApiKey.middleware');
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

/**
 * @swagger
 * /api/v2/webhooks/seguros:
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
 *               - nuevoEstado
 *             properties:
 *               idValidacion:
 *                 type: string
 *                 description: Id de la validación puntual a actualizar (correlación exacta). Si se omite, se usa numeroPoliza como fallback y se actualizan todas las validaciones de esa póliza. Debe venir al menos uno de los dos (idValidacion o numeroPoliza).
 *               numeroPoliza:
 *                 type: string
 *                 description: Fallback cuando no se envía idValidacion. Debe venir al menos uno de los dos (idValidacion o numeroPoliza).
 *               estadoAnterior:
 *                 type: string
 *                 description: Informativo — se adjunta al evento publicado, no se valida contra el estado actual del registro.
 *               nuevoEstado:
 *                 type: string
 *                 enum: [VIGENTE, SUSPENDIDA, CANCELADA]
 *               fechaActualizacion:
 *                 type: string
 *                 format: date-time
 *                 description: Opcional, solo informativo.
 *     responses:
 *       200:
 *         description: Estado actualizado exitosamente en el sistema de MediCitas
 *       400:
 *         description: Faltan campos obligatorios (nuevoEstado, junto con idValidacion o numeroPoliza)
 *       401:
 *         description: API Key inválida
 *       500:
 *         description: Error interno del servidor
 */
router.post(
  '/',
  verifyWebhookApiKey('ASEGURADORA_API_KEY'),
  controller.recibirWebhook
);

module.exports = router;
