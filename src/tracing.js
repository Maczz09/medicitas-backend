'use strict';

/**
 * Bootstrap de OpenTelemetry — tracing distribuido hacia Jaeger.
 *
 * CRÍTICO: este archivo debe ser el PRIMER require de server.js, antes que
 * cualquier módulo instrumentado (express, http, mysql2, amqplib, axios/redis).
 * La auto-instrumentación parchea esos módulos en el momento en que Node los
 * carga por primera vez — si se cargan antes que el SDK arranque, quedan sin
 * instrumentar y no aparecen spans para ellos.
 */

require('dotenv').config();

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'medicitas-backend',
  }),
  traceExporter: new OTLPTraceExporter({ url: OTEL_ENDPOINT }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Ruido de bajo valor: metrics/health-checks propios no aportan al trace
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

try {
  sdk.start();
  // eslint-disable-next-line no-console
  console.log(`[Tracing] OpenTelemetry iniciado — exportando a ${OTEL_ENDPOINT}`);
} catch (err) {
  // No debe tumbar el arranque del servidor si Jaeger no está disponible aún.
  // eslint-disable-next-line no-console
  console.error('[Tracing] No se pudo iniciar OpenTelemetry:', err.message);
}

process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => {});
});
