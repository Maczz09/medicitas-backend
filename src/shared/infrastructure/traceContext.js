// Propagación del contexto de traza (W3C traceparent) a través del patrón
// outbox — para que en Jaeger el flujo cita → pago → seguro → factura →
// notificación sea UNA sola cascada y no trazas separadas.
//
// El outbox rompe la propagación automática de OpenTelemetry: el evento se
// escribe a una tabla MySQL y un worker aparte (otro proceso) lo publica a
// RabbitMQ, así que el contexto del request HTTP original se pierde. En vez de
// agregar una columna a las 11 tablas outbox, se reutiliza el patrón que el
// proyecto ya usa para _actor y _timestamp: los metadatos viajan DENTRO del
// payload JSON y rabbitmq.publishEvent los extrae al sobre/headers del mensaje
// antes de publicar. Cero migración de esquema y sirve para ambas convenciones
// de tabla outbox.
//
// Flujo completo:
//   1. capturarTraceMeta() en cada OutboxMySQLPublisher — captura el contexto
//      activo (request HTTP o handler de consumer) como _traceparent en el payload.
//   2. rabbitmq.publishEvent (worker outbox, proceso SIN SDK de OTel) — saca
//      _traceparent del payload y lo pone LITERAL como header AMQP. No usa la
//      API de OTel a propósito: sin SDK registrado, inject/extract son no-ops.
//   3. Los consumers (backend, SDK activo) ejecutan su handler dentro del
//      contexto extraído de los headers → sus spans (MySQL, HTTP, y los outbox
//      que ellos mismos escriban) descienden del trace original.
//
// Si OTel está apagado (OTEL_SDK_DISABLED=true, modo carga), inject no escribe
// nada → los payloads no llevan _traceparent y todo degrada limpio.

const { propagation, context, trace } = require('@opentelemetry/api');

// Devuelve { _traceparent, _tracestate } con el contexto activo, u objeto
// vacío si no hay traza activa (OTel apagado o proceso sin SDK).
function capturarTraceMeta() {
  const carrier = {};
  try {
    propagation.inject(context.active(), carrier);
  } catch { /* nunca debe romper la publicación del evento */ }
  const meta = {};
  if (carrier.traceparent) meta._traceparent = carrier.traceparent;
  if (carrier.tracestate)  meta._tracestate  = carrier.tracestate;
  return meta;
}

// Ejecuta fn dentro del contexto de traza que viene en los headers AMQP del
// mensaje (traceparent/tracestate). Si la auto-instrumentación de amqplib ya
// activó un span consumer (que desciende del mismo traceparent), se respeta ese
// contexto — extraer de nuevo aplanaría la jerarquía. Solo se extrae a mano
// cuando no hay span activo (instrumentación ausente o versión que no lo haga).
function ejecutarConContexto(headers, fn) {
  try {
    if (headers?.traceparent && !trace.getSpan(context.active())) {
      const ctx = propagation.extract(context.active(), headers);
      return context.with(ctx, fn);
    }
  } catch { /* ante cualquier fallo de extracción, procesar igual */ }
  return fn();
}

module.exports = { capturarTraceMeta, ejecutarConContexto };
