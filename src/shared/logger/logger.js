const pino = require('pino');
const asyncContext = require('./asyncContext');

// ─── Modelo de observabilidad ─────────────────────────────────────────────────
// En modo "observabilidad" (LOKI_HOST seteado, o NODE_ENV production/docker) la
// app emite JSON de UNA sola línea a stdout y NADA MÁS. El envío a Loki lo hace
// un colector externo (Promtail) que lee el stdout del contenedor y lo reenvía
// a Loki con reintentos y reconexión propios.
//
// Por qué se quitó pino-loki (push directo desde el proceso):
//   Se verificó en vivo que pino-loki 3.0.0 NO se recupera cuando Loki se cae,
//   reinicia, o cuando la app arranca antes que Loki (su `depends_on` no lo
//   incluye y la imagen de Loki es distroless, no healthcheckeable). El push
//   muere en silencio para TODA la vida del proceso: stdout sigue, pero a
//   Grafana no vuelve a llegar nada hasta reiniciar la app. Ese era el motivo
//   real de "no sale nada en Grafana Loki".
//   Además, acoplar el arranque/salud de la API a la infra de logs es incorrecto
//   — la API debe seguir viva aunque Loki no esté. Con el colector externo, el
//   logging queda 100% desacoplado: si Loki se cae, la app sigue escribiendo a
//   stdout y Promtail se pone al día cuando Loki vuelve.
const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'docker';
const modoObservabilidad = !!process.env.LOKI_HOST || isProduction;

// En dev local (sin Loki) usamos pino-pretty para leer cómodo en la terminal.
// En modo observabilidad NO se usa transport: pino escribe JSON directo a stdout
// (fd 1), síncrono y sin worker threads que puedan morir en silencio.
const transport = modoObservabilidad
  ? undefined
  : pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    });

const pinoLogger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    // `app` identifica al emisor (backend vs workers). Promtail lo copia al
    // label `app` de Loki — las dashboards consultan {app="medicitas-backend"}.
    base: { app: process.env.LOKI_APP_LABEL || 'medicitas-backend', pid: process.pid },
    // ISO legible; Promtail usa el timestamp del propio stream de Docker, así
    // que el formato exacto aquí no afecta el orden en Loki.
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const store = asyncContext.getStore();
      return {
        correlationId: store ? store.get('correlationId') : undefined,
        operation: store ? store.get('operation') : undefined,
        orderId: store ? store.get('orderId') : undefined,
      };
    },
  },
  transport,
);

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
