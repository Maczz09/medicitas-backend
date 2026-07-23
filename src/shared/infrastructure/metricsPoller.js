// Puebla con datos reales dos gauges de Prometheus que ya existían en
// config/metrics.js y ya tenían panel en monitoring/grafana/dashboards/
// operativo.json (Saturación de Outbox, DLQ) pero NUNCA se actualizaban en
// ningún lado — quedaban sembradas en 0 para siempre (metrics.js líneas
// 145-146), mostrando una falsa sensación de "todo en cero" incluso con
// backlog real (confirmado en vivo: 354 filas pendientes en solo un
// esquema durante esta sesión). Sin infraestructura nueva: reusa el pool de
// MySQL y el canal de RabbitMQ que YA están conectados en este mismo proceso
// — no agrega contenedores, puertos ni scrape targets.
const dbPool = require('../../config/database');
const rabbitmq = require('../../config/rabbitmq');
const logger = require('../logger/logger');
const { outboxPendingGauge, dlqSizeGauge } = require('../../config/metrics');

// Mismos 12 esquemas que workers/outbox.worker.js#SCHEMAS — si se agrega un
// módulo nuevo ahí, agregarlo aquí también.
const SCHEMAS_OUTBOX = [
  'medicitas_users', 'svc_cit', 'svc_pac', 'svc_med', 'svc_pag',
  'svc_hcl', 'svc_seg', 'svc_not', 'svc_aud', 'svc_pre', 'svc_fac', 'svc_hor',
];

// Mismas 4 colas .dlq configuradas en config/rabbitmq.js#connect().
const COLAS_DLQ = ['q.auditoria.dlq', 'q.notificaciones.dlq', 'q.prescripciones.dlq', 'q.facturacion.dlq'];

const INTERVAL_MS = parseInt(process.env.METRICS_POLL_INTERVAL_MS || '15000', 10);

async function actualizarOutbox() {
  for (const schema of SCHEMAS_OUTBOX) {
    try {
      const [[{ total }]] = await dbPool.query(
        `SELECT COUNT(*) AS total FROM ${schema}.outbox WHERE estado = 'PENDIENTE'`,
      );
      outboxPendingGauge.set({ service: schema }, total);
    } catch (err) {
      // ER_NO_SUCH_TABLE es esperable si el esquema aún no tiene outbox
      // (entornos parciales/tests) — no es un fallo real que loguear.
      if (err.code !== 'ER_NO_SUCH_TABLE') {
        logger.warn({ schema, err: err.message }, '[MetricsPoller] No se pudo medir el backlog de outbox');
      }
    }
  }
}

async function actualizarDLQ() {
  const channel = rabbitmq.getChannel();
  if (!channel) return; // RabbitMQ desconectado en este momento — se reintenta en el próximo ciclo

  for (const cola of COLAS_DLQ) {
    try {
      const { messageCount } = await channel.checkQueue(cola);
      dlqSizeGauge.set({ queue: cola }, messageCount);
    } catch (err) {
      logger.warn({ cola, err: err.message }, '[MetricsPoller] No se pudo medir la DLQ');
    }
  }
}

let _timer = null;
function iniciar() {
  if (_timer) return; // ya iniciado — evita duplicar el interval en hot-reload/tests
  const ciclo = () => {
    actualizarOutbox().catch((err) => logger.error({ err: err.message }, '[MetricsPoller] Error midiendo outbox'));
    actualizarDLQ().catch((err) => logger.error({ err: err.message }, '[MetricsPoller] Error midiendo DLQ'));
  };
  ciclo(); // primer valor real de inmediato, no esperar el primer intervalo
  _timer = setInterval(ciclo, INTERVAL_MS);
  _timer.unref(); // no mantiene vivo el proceso en tests/shutdown
}

module.exports = { iniciar };
