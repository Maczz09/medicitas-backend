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

const authRouter = require('./modules/auth/infrastructure/http/v1/auth.routes');
const pacientesRouter = require('./modules/pacientes/infrastructure/http/v1/pacientes.routes');
const medicosRouter = require('./modules/medicos/infrastructure/http/v1/medicos.routes');
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

const app = express();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
  standardHeaders: true,
  legacyHeaders: false,
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

app.use('/api/v1/auth', authLimiter, authRouter);
app.use('/api/v1/pacientes', pacientesRouter);
app.use('/api/v1/medicos', medicosRouter);
app.use('/api/v1/citas', citasRoutes);
app.use('/api/v1/coberturas', segurosRoutes);
app.use('/api/v1/pagos', pagosRouter);
app.use('/api/v1/historias-clinicas', hclRouter);
app.use('/api/v1/prescripciones', preRouter);
app.use('/api/v1/facturacion', facRouter);
app.use('/api/v1/auditoria', audRouter);
app.use('/api/v1/notificaciones', notRouter);

// Webhooks internos (protegidos por API KEY en su propia ruta)
app.use('/api/v1/webhooks', webhookRouter); // El de prescripciones
app.use('/api/v1/webhooks/seguros', segurosWebhookRouter);

// Webhooks externos (sin rate-limit ni auth — validados por firma Twilio)
app.use('/webhooks/twilio', twilioWebhook);

// Ruta Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(errorHandler);

module.exports = app;
