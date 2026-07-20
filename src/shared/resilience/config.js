'use strict';

// Constantes de resiliencia — única fuente de verdad para TODOS los
// adaptadores S2S HTTP (internos y externos). Reemplaza los nombres de env
// var que antes estaban dispersos y colisionados (CB_TIMEOUT_MS compartido
// por accidente entre el CB de Seguros y el de SMS; CB_TIMEOUT_MS_FARMACIA
// con su propio sufijo; RETRY_BASE_MS/RETRY_MAX_MS pensados para el Full
// Jitter anterior). Ver .env.example para el detalle de la migración.
//
// Horario de reintentos FIJO (no Full Jitter): 3s, 5s, 8s ± 200ms de jitter.
// Requisito explícito del docente — demostrable con números literales en
// logs/chaos-log — a costa de un peor caso más alto que el Full Jitter
// anterior (200ms-2s). Aceptado conscientemente: ver HighLatencyP95 en
// monitoring/alert.rules.yml, que se espera dispare durante fallos reales.

function parseSchedule(env, fallback) {
  if (!env) return fallback;
  const valores = env.split(',').map((v) => parseInt(v.trim(), 10));
  if (valores.length === 0 || valores.some((v) => Number.isNaN(v))) return fallback;
  return valores;
}

const RETRY_SCHEDULE_MS = parseSchedule(process.env.RETRY_SCHEDULE_MS, [3000, 5000, 8000]);
const RETRY_JITTER_MS = parseInt(process.env.RETRY_JITTER_MS || '200', 10);

const TIMEOUT_SCHEDULE_MS = parseSchedule(process.env.TIMEOUT_SCHEDULE_MS, [2000, 4000, 8000]);

// CB_TIMEOUT_MS debe ser MAYOR que el timeout del último intento (mismo
// criterio que ya usaba el código anterior: axios 3000 < CB 3500, margen de
// 500ms — con el último intento ahora en 8000ms, el margen se conserva).
const CB_TIMEOUT_MS = parseInt(process.env.CB_TIMEOUT_MS || '8500', 10);
const CB_ERROR_THRESHOLD_PERCENTAGE = parseInt(process.env.CB_ERROR_THRESHOLD_PERCENTAGE || '50', 10);
const CB_RESET_TIMEOUT_MS = parseInt(process.env.CB_RESET_TIMEOUT_MS || '30000', 10);
const CB_VOLUME_THRESHOLD = parseInt(process.env.CB_VOLUME_THRESHOLD || '5', 10);
const CB_ROLLING_COUNT_TIMEOUT_MS = parseInt(process.env.CB_ROLLING_COUNT_TIMEOUT_MS || '10000', 10);
const CB_ROLLING_COUNT_BUCKETS = parseInt(process.env.CB_ROLLING_COUNT_BUCKETS || '10', 10);

const BULKHEAD_MAX_SOCKETS = parseInt(process.env.BULKHEAD_MAX_SOCKETS || '20', 10);

// Timeout de axios para el intento N (1-based) — único punto de indexación
// del schedule. Los adaptadores lo llaman en vez de indexar el array a
// mano, para no repetir el mismo off-by-one potencial en cada archivo.
// Clampea al último valor si intento excede el schedule (no debería pasar,
// dado que conReintentos deriva maxIntentos de RETRY_SCHEDULE_MS.length).
function obtenerTimeoutParaIntento(intento) {
  const idx = Math.min(intento, TIMEOUT_SCHEDULE_MS.length) - 1;
  return TIMEOUT_SCHEDULE_MS[idx];
}

// Horario de timeout PROPIO para descargas de PDF (DocumentoHttpAdapter).
// Generar+servir un comprobante/receta puede tardar genuinamente más que un
// lookup JSON — con el horario genérico (2s/4s/8s) una descarga de ~10s
// agotaba los 3 intentos y fallaba, cuando antes (timeout fijo de 15s) sí
// tenía margen. Mismo principio de escalada, techo más alto (5s/10s/15s,
// termina en el mismo techo que el timeout fijo anterior).
const PDF_TIMEOUT_SCHEDULE_MS = parseSchedule(process.env.PDF_TIMEOUT_SCHEDULE_MS, [5000, 10000, 15000]);

// CB propio para ese mismo adaptador: opossum mide el `breaker.fire()`
// completo, así que su timeout debe superar el ÚLTIMO valor de ESTE
// horario (15000), no el genérico (CB_TIMEOUT_MS=8500 se quedaría corto y
// el breaker cortaría antes de que axios llegue a intentarlo).
const CB_TIMEOUT_MS_PDF = parseInt(
  process.env.CB_TIMEOUT_MS_PDF || String(PDF_TIMEOUT_SCHEDULE_MS[PDF_TIMEOUT_SCHEDULE_MS.length - 1] + 500),
  10,
);

function obtenerTimeoutPdfParaIntento(intento) {
  const idx = Math.min(intento, PDF_TIMEOUT_SCHEDULE_MS.length) - 1;
  return PDF_TIMEOUT_SCHEDULE_MS[idx];
}

module.exports = {
  RETRY_SCHEDULE_MS,
  RETRY_JITTER_MS,
  TIMEOUT_SCHEDULE_MS,
  CB_TIMEOUT_MS,
  CB_ERROR_THRESHOLD_PERCENTAGE,
  CB_RESET_TIMEOUT_MS,
  CB_VOLUME_THRESHOLD,
  CB_ROLLING_COUNT_TIMEOUT_MS,
  CB_ROLLING_COUNT_BUCKETS,
  BULKHEAD_MAX_SOCKETS,
  obtenerTimeoutParaIntento,
  PDF_TIMEOUT_SCHEDULE_MS,
  CB_TIMEOUT_MS_PDF,
  obtenerTimeoutPdfParaIntento,
};
