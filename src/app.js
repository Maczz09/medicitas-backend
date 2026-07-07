const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { swaggerUi, specs } = require('./config/swagger');
const { correlationMiddleware } = require('./shared/infrastructure/correlation.middleware');
const { errorHandler } = require('./shared/infrastructure/error.middleware');
const { checkIdempotency } = require('./shared/infrastructure/api_idempotency.middleware');
const { metricsMiddleware } = require('./shared/infrastructure/metrics.middleware');
const { register } = require('./config/metrics');

const authRouter = require('./modules/auth/routes/auth.routes');
const pacientesRouter = require('./modules/pacientes/routes/pacientes.routes');
const medicosRouter = require('./modules/medicos/routes/medicos.routes');
const citasRoutes = require('./modules/citas/infrastructure/http/v1/citas.routes');
const segurosRoutes = require('./modules/seguros/routes/seguros.routes');
const pagosRouter = require('./modules/pagos/routes/pagos.routes');
const hclRouter = require('./modules/historiaClinica/routes/historiaClinica.routes');
const preRouter = require('./modules/prescripciones/routes/prescripciones.routes');
const facRouter = require('./modules/facturacion/routes/facturacion.routes');
const audRouter = require('./modules/auditoria/routes/auditoria.routes');
const notRouter     = require('./modules/notificaciones/routes/notificaciones.routes');
const webhookRouter = require('./modules/prescripciones/routes/webhook.routes');
const segurosWebhookRouter = require('./modules/seguros/routes/webhook.routes');
const twilioWebhook = require('./shared/infrastructure/webhooks/twilio.webhook');
const { realtimeRouter } = require('./shared/infrastructure/realtime.routes');
const serviceSwitchRouter = require('./shared/infrastructure/serviceSwitch.routes');
const { killSwitch } = require('./shared/infrastructure/killSwitch.middleware');

const app = express();
app.set('trust proxy', 1);

// Las llamadas S2S internas (PacienteHttpAdapter, CitaHttpAdapter, etc.) se
// enrutan por HTTP hacia el propio proceso (localhost:3000/api/v2/...) y
// pasan por este mismo router — sin este skip, comparten presupuesto con el
// tráfico público y un pico de eventos en cola (consumers RabbitMQ) puede
// agotar el límite y devolver 429 en cascada a operaciones internas legítimas.
function esLlamadaInterna(req) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  return !!token && !!process.env.INTERNAL_SERVICE_TOKEN && token === process.env.INTERNAL_SERVICE_TOKEN.trim();
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: esLlamadaInterna,
  message: { error: 'Demasiadas peticiones. Intenta de nuevo más tarde.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '20'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Intenta de nuevo en 15 minutos.' },
});

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(metricsMiddleware);
app.use(correlationMiddleware);
app.use(checkIdempotency);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Healthcheck del sistema
 *     description: Endpoint para verificar que el servicio está vivo y responde. Usado por balanceadores de carga y el autoheal.
 *     tags:
 *       - Infraestructura
 *     responses:
 *       200:
 *         description: El servicio está operando correctamente
 */
// Endpoint de salud (Heartbeat) para Docker Healthcheck
app.get('/health', (req, res) => res.status(200).json({ status: 'OK', timestamp: new Date() }));

// Endpoint de métricas para Prometheus (solo accesible internamente)
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

app.use('/api/', apiLimiter);

app.use('/api/v2/auth', authLimiter, authRouter);
app.use('/api/v2/pacientes', pacientesRouter);
app.use('/api/v2/medicos', medicosRouter);
app.use('/api/v2/citas', citasRoutes);
app.use('/api/v2/coberturas', segurosRoutes);
app.use('/api/v2/pagos', killSwitch('pagos'), pagosRouter);
app.use('/api/v2/admin/servicios', serviceSwitchRouter);
app.use('/api/v2/historias-clinicas', hclRouter);
app.use('/api/v2/prescripciones', preRouter);
app.use('/api/v2/facturacion', facRouter);
app.use('/api/v2/auditoria', audRouter);
app.use('/api/v2/notificaciones', notRouter);
app.use('/api/v2/realtime', realtimeRouter);

// Webhooks entrantes de servicios externos (farmacia-api, aseguradora-api) — protegidos por API Key compartida
app.use('/api/v2/webhooks/farmacia', webhookRouter);
app.use('/api/v2/webhooks/seguros', segurosWebhookRouter);

// Webhooks externos (sin rate-limit ni auth — validados por firma Twilio)
app.use('/webhooks/twilio', twilioWebhook);

// Ruta Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(errorHandler);

module.exports = app;
