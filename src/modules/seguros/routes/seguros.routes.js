const express = require('express');
const { verifyToken } = require('../../../shared/infrastructure/auth.middleware');
const { requireRole } = require('../../../shared/infrastructure/rbac.middleware');
const { correlationMiddleware } = require('../../../shared/infrastructure/correlation.middleware');
const { checkIdempotency } = require('../../../shared/infrastructure/api_idempotency.middleware');

const { SegurosController } = require('../adapters/in/SegurosController');
const { CoberturasMySQLRepository } = require('../adapters/out/repositories/CoberturasMySQLRepository');
const { AseguradoraMockAdapter } = require('../adapters/out/gateway/AseguradoraMockAdapter');
const { AseguradoraAxiosAdapter } = require('../adapters/out/gateway/AseguradoraAxiosAdapter');
const { PacienteHttpAdapter } = require('../adapters/out/http/PacienteHttpAdapter');
const { OutboxMySQLPublisher } = require('../adapters/out/events/OutboxMySQLPublisher');

const { ValidarCoberturaUseCase } = require('../application/use-cases/ValidarCoberturaUseCase');
const { ConsultarValidacionUseCase } = require('../application/use-cases/ConsultarValidacionUseCase');

const dbPool = require('../../../config/database');

// ── 1. Adaptadores ────────────────────────────────────────────────────────────
const coberturaRepo     = new CoberturasMySQLRepository(dbPool);
const pacienteValidator = new PacienteHttpAdapter();
const eventPublisher    = new OutboxMySQLPublisher();

// Selector de implementación — configurable vía variable de entorno
const useMockSeguro = process.env.USE_MOCK_SEGURO !== 'false';
const aseguradoraGateway = useMockSeguro 
  ? new AseguradoraMockAdapter() 
  : new AseguradoraAxiosAdapter();

const getConnection = async () => await dbPool.getConnection();

// ── 2. Casos de Uso ───────────────────────────────────────────────────────────
const validarCoberturaUseCase = new ValidarCoberturaUseCase({
  coberturaRepository: coberturaRepo,
  aseguradoraGateway,
  pacienteValidator,
  eventPublisher,
  getConnection
});

const consultarValidacionUseCase = new ConsultarValidacionUseCase({
  coberturaRepository: coberturaRepo
});

// ── 3. Controlador ────────────────────────────────────────────────────────────
const controller = new SegurosController({
  validarCoberturaUseCase,
  consultarValidacionUseCase
});

// ── 4. Rutas ──────────────────────────────────────────────────────────────────
const router = express.Router();

router.use(correlationMiddleware);

/**
 * @swagger
 * tags:
 *   name: Seguros
 *   description: Integración con aseguradoras y validación de cobertura
 */

/**
 * @swagger
 * /api/v1/coberturas/validar:
 *   post:
 *     summary: Validar la cobertura de un paciente con la aseguradora
 *     tags: [Seguros]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idPaciente
 *               - idAseguradora
 *               - numeroPoliza
 *               - tipoConsulta
 *             properties:
 *               idPaciente:
 *                 type: string
 *               idAseguradora:
 *                 type: string
 *               numeroPoliza:
 *                 type: string
 *               tipoConsulta:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validación completada (puede ser APROBADA, RECHAZADA o PENDIENTE)
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Paciente no encontrado
 *       500:
 *         description: Error interno al comunicarse con la aseguradora
 */
router.post('/validar',
  verifyToken,
  requireRole(['Recepcionista', 'INTERNAL']),
  checkIdempotency,
  controller.validarCobertura
);

/**
 * @swagger
 * /api/v1/coberturas/{id}:
 *   get:
 *     summary: Consultar el resultado de una validación de cobertura existente
 *     tags: [Seguros]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la validación
 *     responses:
 *       200:
 *         description: Detalles de la validación
 *       404:
 *         description: Validación no encontrada
 */
router.get('/:id',
  verifyToken,
  requireRole(['Recepcionista', 'INTERNAL']),
  controller.consultarValidacion
);

module.exports = router;
