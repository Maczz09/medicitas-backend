const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duración de peticiones HTTP en segundos',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de peticiones HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestErrors = new client.Counter({
  name: 'http_request_errors_total',
  help: 'Total de errores HTTP (4xx y 5xx)',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const activeConnections = new client.Gauge({
  name: 'http_active_connections',
  help: 'Conexiones HTTP activas en este momento',
  registers: [register],
});

// --- Métricas de Negocio (Domain Metrics) ---

const citasCreadasCounter = new client.Counter({
  name: 'medicitas_citas_creadas_total',
  help: 'Total de citas reservadas (por especialidad)',
  labelNames: ['especialidad'],
  registers: [register],
});

const segurosValidadosCounter = new client.Counter({
  name: 'medicitas_seguros_validados_total',
  help: 'Total de seguros validados (aprobado o rechazado)',
  labelNames: ['estado', 'aseguradora'],
  registers: [register],
});

const prescripcionesDespachadasCounter = new client.Counter({
  name: 'medicitas_prescripciones_despachadas_total',
  help: 'Total de recetas enviadas y despachadas',
  registers: [register],
});

const pagosCompletadosCounter = new client.Counter({
  name: 'medicitas_pagos_completados_total',
  help: 'Total de transacciones de pago completadas',
  labelNames: ['metodo_pago'],
  registers: [register],
});

const pagosMontoTotal = new client.Counter({
  name: 'medicitas_pagos_procesados_monto_total',
  help: 'Suma total de ingresos procesados (S/.)',
  labelNames: ['metodo_pago'],
  registers: [register],
});

const encuentrosHclCounter = new client.Counter({
  name: 'medicitas_hcl_encuentros_registrados_total',
  help: 'Total de encuentros clínicos finalizados',
  registers: [register],
});

const comprobantesEmitidosCounter = new client.Counter({
  name: 'medicitas_comprobantes_emitidos_total',
  help: 'Boletas y facturas generadas',
  registers: [register],
});

const smsEnviadosCounter = new client.Counter({
  name: 'medicitas_notificaciones_sms_enviadas_total',
  help: 'Alertas SMS enviadas a pacientes',
  registers: [register],
});

// --- Métricas USE y Resiliencia (SRE) ---

const outboxPendingGauge = new client.Gauge({
  name: 'medicitas_outbox_pending_messages',
  help: 'Cantidad de mensajes en estado PENDIENTE en el Outbox (Saturación)',
  labelNames: ['service'],
  registers: [register],
});

const dlqSizeGauge = new client.Gauge({
  name: 'medicitas_dlq_size',
  help: 'Cantidad de mensajes en la Dead Letter Queue (Saturación de fallos)',
  labelNames: ['queue'],
  registers: [register],
});

const circuitBreakerStateGauge = new client.Gauge({
  name: 'medicitas_circuit_breaker_state',
  help: 'Estado del Circuit Breaker (0=Cerrado, 1=Abierto, 2=Medio Abierto)',
  labelNames: ['service'],
  registers: [register],
});

module.exports = { 
  register, 
  httpRequestDuration, 
  httpRequestTotal, 
  httpRequestErrors, 
  activeConnections,
  citasCreadasCounter,
  segurosValidadosCounter,
  prescripcionesDespachadasCounter,
  pagosCompletadosCounter,
  pagosMontoTotal,
  encuentrosHclCounter,
  comprobantesEmitidosCounter,
  smsEnviadosCounter,
  outboxPendingGauge,
  dlqSizeGauge,
  circuitBreakerStateGauge
};

// --- Inicialización para Dashboards ---
// Esto asegura que Prometheus reporte '0' desde el inicio y Grafana no muestre "No data".
outboxPendingGauge.set({ service: 'medicitas-workers' }, 0);
dlqSizeGauge.set({ queue: 'medicitas-dlq' }, 0);
circuitBreakerStateGauge.set({ service: 'AseguradoraAPI' }, 0);
pagosMontoTotal.inc({ metodo_pago: 'TARJETA' }, 0);
pagosCompletadosCounter.inc({ metodo_pago: 'TARJETA' }, 0);
citasCreadasCounter.inc({ especialidad: 'General' }, 0);
