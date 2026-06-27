const pino = require('pino');
const asyncContext = require('./asyncContext');

const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'docker';

const transport = isProduction 
  ? pino.transport({
      target: 'pino-loki',
      options: {
        batching: true,
        interval: 5,
        host: 'http://loki:3100',
        labels: { app: 'medicitas-backend' }
      }
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
  timestamp: pino.stdTimeFunctions.isoTime,
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
