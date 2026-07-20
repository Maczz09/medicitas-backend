const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { swaggerUi, specs } = require('./config/swagger');
const { correlationMiddleware } = require('./shared/infrastructure/correlation.middleware');
const { errorHandler } = require('./shared/infrastructure/error.middleware');
const { checkIdempotency } = require('./shared/infrastructure/api_idempotency.middleware');
const { httpLogger } = require('./shared/infrastructure/httpLogger.middleware');
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

// En modo de pruebas de carga (LOAD_TEST_MODE=true) se desactiva el rate
// limiting — de lo contrario k6 choca contra el muro de 200 req/15min en la
// primera fracción de segundo. En producción (flag ausente) sigue idéntico.
const esModoCarga = () => process.env.LOAD_TEST_MODE === 'true';

// Clave del rate limit POR USUARIO cuando hay token (no solo por IP): detrás de
// un NAT/proxy muchos usuarios comparten IP y se penalizarían entre sí. Se lee el
// `sub` del JWT sin verificar la firma (solo para keying; auth ya valida el token
// aparte). Sin token válido, cae a la IP. `req.ip` se normaliza para IPv6.
const { ipKeyGenerator } = rateLimit;
function claveRateLimit(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (token) {
    try {
      const parte = token.split('.')[1];
      if (parte) {
        const payload = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
        const uid = payload.sub || payload.idUsuario;
        if (uid) return `u:${uid}`;
      }
    } catch { /* token ilegible → cae a IP */ }
  }
  return ipKeyGenerator ? ipKeyGenerator(req, res) : req.ip;
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: claveRateLimit,
  skip: (req, res) => esModoCarga() || esLlamadaInterna(req, res),
  message: { error: 'Demasiadas peticiones. Intenta de nuevo más tarde.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '20'),
  standardHeaders: true,
  legacyHeaders: false,
  skip: esModoCarga,
  message: { error: 'Demasiados intentos de autenticación. Intenta de nuevo en 15 minutos.' },
});

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(metricsMiddleware);
app.use(correlationMiddleware);
app.use(httpLogger); // log de acceso por petición (después de correlation, para tener el correlationId)
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
// Liveness (Heartbeat) para Docker Healthcheck — SOLO comprueba que el proceso
// responde. NO verifica dependencias a propósito: si MySQL/Redis se caen,
// reiniciar el backend no los arregla; el liveness solo detecta un proceso muerto.
app.get('/health', (req, res) => res.status(200).json({ status: 'OK', timestamp: new Date() }));

// Readiness PROFUNDO — verifica las dependencias reales (MySQL, Redis, RabbitMQ)
// y devuelve 503 si alguna está caída. Para monitoreo/balanceadores: sirve para
// dejar de enrutar tráfico a una instancia que no puede atender aunque el proceso
// siga vivo. Antes solo existía /health devolviendo "OK" sin comprobar nada.
app.get('/health/ready', async (req, res) => {
  const database = require('./config/database');
  const redis = require('./config/redis');
  const rabbitmq = require('./config/rabbitmq');

  const checks = {};
  let ok = true;

  try { await database.query('SELECT 1'); checks.mysql = 'up'; }
  catch { checks.mysql = 'down'; ok = false; }

  try {
    if (redis.client.isOpen) { await redis.client.ping(); checks.redis = 'up'; }
    else { checks.redis = 'down'; ok = false; }
  } catch { checks.redis = 'down'; ok = false; }

  // Desde que cada worker de cluster se conecta a RabbitMQ para su propia
  // cola de realtime SSE (ver server.js), TODOS los workers tienen canal —
  // ya no hay un caso "worker solo-HTTP sin canal" que tratar como n/a.
  try {
    checks.rabbitmq = rabbitmq.getChannel() ? 'up' : 'down';
    if (checks.rabbitmq === 'down') ok = false;
  } catch { checks.rabbitmq = 'down'; ok = false; }

  res.status(ok ? 200 : 503).json({
    status: ok ? 'READY' : 'NOT_READY',
    checks,
    timestamp: new Date().toISOString(),
  });
});

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
app.use('/api/v2/pacientes', killSwitch('pacientes'), pacientesRouter);
app.use('/api/v2/medicos', killSwitch('medicos'), medicosRouter);
app.use('/api/v2/citas', killSwitch('citas'), citasRoutes);
app.use('/api/v2/coberturas', killSwitch('seguros'), segurosRoutes);
app.use('/api/v2/pagos', killSwitch('pagos'), pagosRouter);
app.use('/api/v2/admin/servicios', serviceSwitchRouter);
app.use('/api/v2/historias-clinicas', killSwitch('historias-clinicas'), hclRouter);
app.use('/api/v2/prescripciones', killSwitch('prescripciones'), preRouter);
app.use('/api/v2/facturacion', killSwitch('facturacion'), facRouter);
app.use('/api/v2/auditoria', audRouter);
app.use('/api/v2/notificaciones', killSwitch('notificaciones'), notRouter);
app.use('/api/v2/realtime', realtimeRouter);

// Webhooks entrantes de servicios externos (farmacia-api, aseguradora-api) — protegidos por API Key compartida
app.use('/api/v2/webhooks/farmacia', webhookRouter);
app.use('/api/v2/webhooks/seguros', segurosWebhookRouter);

// Webhooks externos (sin rate-limit ni auth — validados por firma Twilio)
app.use('/webhooks/twilio', twilioWebhook);

// Ruta Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// Catch-all 404: cualquier ruta no montada arriba responde con el MISMO
// envelope JSON estándar, no con el "Cannot GET ..." en HTML por defecto de
// Express. Debe ir DESPUÉS de todas las rutas y ANTES del errorHandler.
app.use((req, res) => {
  res.status(404).json({
    codigo: 'RUTA_NO_ENCONTRADA',
    mensaje: `La ruta ${req.method} ${req.originalUrl} no existe.`,
    correlationId: req.correlationId || null,
    timestamp: new Date().toISOString(),
  });
});

app.use(errorHandler);

module.exports = app;
