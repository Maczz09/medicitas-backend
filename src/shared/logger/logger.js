const pino = require('pino');
const asyncContext = require('./asyncContext');

// Loki se activa de forma explícita con LOKI_HOST (independiente de NODE_ENV)
// o implícita en production/docker. Con NODE_ENV=development y sin LOKI_HOST,
// se usa pino-pretty y los logs NUNCA llegan a Grafana.
const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'docker';
const usarLoki = !!process.env.LOKI_HOST || isProduction;

// CRÍTICO: cuando Loki está activo, el log NUNCA debe depender exclusivamente
// de él — si Loki se cae o hay un corte de DNS momentáneo (pasa en cada
// recreación de contenedores), pino-loki descarta el batch en silencio y esas
// líneas desaparecen para siempre: no llegan a Grafana NI a `docker logs`.
// Con `targets`, stdout (pino-pretty) y Loki corren en paralelo e
// independientes — `docker logs` sigue siendo la fuente de verdad pase lo
// que pase con Loki.
const transport = usarLoki
  ? pino.transport({
      targets: [
        {
          target: 'pino-pretty',
          level: process.env.LOG_LEVEL || 'info',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
        {
          target: 'pino-loki',
          level: process.env.LOG_LEVEL || 'info',
          options: {
            batching: true,
            interval: 5,
            host: process.env.LOKI_HOST || 'http://loki:3100',
            // La etiqueta `app` distingue el emisor en Grafana (backend vs workers)
            labels: { app: process.env.LOKI_APP_LABEL || 'medicitas-backend' },
          },
        },
      ],
    })
  : pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard'
      }
    });

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  // pino-loki necesita `time` numérico (epoch ms) para construir el timestamp
  // del push; con isoTime genera NaN y Loki rechaza TODOS los lotes.
  timestamp: usarLoki ? pino.stdTimeFunctions.epochTime : pino.stdTimeFunctions.isoTime,
  mixin() {
    const store = asyncContext.getStore();
    return { 
      correlationId: store ? store.get('correlationId') : undefined,
      operation: store ? store.get('operation') : undefined,
      orderId: store ? store.get('orderId') : undefined
    };
  }
}, transport);

const logger = {
  info: (data, message) => {
    if (typeof data === 'string') pinoLogger.info({ msg: data });
    else pinoLogger.info({ ...data, msg: message || '' });
  },
  warn: (data, message) => {
    if (typeof data === 'string') pinoLogger.warn({ msg: data });
    else pinoLogger.warn({ ...data, msg: message || '' });
  },
  error: (data, message) => {
    if (typeof data === 'string') pinoLogger.error({ msg: data });
    else pinoLogger.error({ ...data, msg: message || '' });
  },
  debug: (data, message) => {
    if (typeof data === 'string') pinoLogger.debug({ msg: data });
    else pinoLogger.debug({ ...data, msg: message || '' });
  },
  // SRE: Registro Estricto de Diagnóstico Operativo
  diagnostic: ({ service = 'medicitas-backend', operation, dependency, durationMs, errorCode = null, resultingState = 'SUCCESS', orderId, msg = '' }) => {
    const payload = {
      service,
      operation,
      dependency,
      durationMs,
      errorCode,
      resultingState,
      orderId,
      msg
    };
    if (resultingState === 'ERROR' || resultingState === 'FAILURE') {
      pinoLogger.error(payload);
    } else if (resultingState === 'DEGRADED') {
      pinoLogger.warn(payload);
    } else {
      pinoLogger.info(payload);
    }
  }
};

module.exports = logger;
