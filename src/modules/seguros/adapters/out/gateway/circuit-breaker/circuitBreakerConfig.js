const CircuitBreaker = require('opossum');
const logger = require('../../../../../../shared/logger/logger');

/**
 * crearCircuitBreaker — SIN .fallback() registrado en opossum.
 *
 * ⚠️ Anti-patrón eliminado: registrar .fallback() en el breaker hace que
 * breaker.fire() NUNCA rechace la promesa cuando falla — resuelve directamente
 * con el valor de fallback. El wrapper conRetryYFallback (capa más externa)
 * jamás vería un error que reintentar. Resultado: el Retry existe en el código
 * pero nunca se ejecuta. Ver sección 13 del plan de implementación v2.
 *
 * El fallback ahora vive exclusivamente en conRetryYFallback, que es la capa
 * más externa. Orden correcto:
 *
 *   conRetryYFallback()     ← decide reintentar o devolver fallback
 *     └─► breaker.fire()   ← circuit breaker puro (abre/cierra/rechaza)
 *           └─► axios.get  ← llamada real con timeout
 */
function crearCircuitBreaker(llamadaExterna) {
  const opciones = {
    // ⚠️ CB_TIMEOUT_MS debe ser MAYOR que HTTP_TIMEOUT_MS (axios).
    // Si fuera menor, opossum se "rendiría" antes de que axios termine,
    // generando un falso timeout del breaker con la petición aún viva.
    // Configuración correcta: HTTP_TIMEOUT_MS=3000 < CB_TIMEOUT_MS=3500
    timeout:                  parseInt(process.env.CB_TIMEOUT_MS      || '3500'),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD  || '50'),
    resetTimeout:             parseInt(process.env.CB_RESET_TIMEOUT_MS || '30000'),
    volumeThreshold:          5,      // Mínimo 5 peticiones antes de evaluar el umbral
    rollingCountTimeout:      10000,  // Ventana deslizante de 10s para contar errores
    rollingCountBuckets:      10,     // Granularidad de la ventana
  };

  const breaker = new CircuitBreaker(llamadaExterna, opciones);

  // ── Eventos de observabilidad ─────────────────────────────────────────────
  // Sin .fallback() — los rechazos llegan a conRetryYFallback como excepciones
  breaker.on('open',     () => logger.warn({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker ABIERTO — demasiados fallos. Próximas llamadas irán directamente al fallback.'));

  breaker.on('halfOpen', () => logger.info({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker SEMI-ABIERTO — probando reconexión con API Aseguradora.'));

  breaker.on('close',    () => logger.info({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker CERRADO — API Aseguradora disponible nuevamente.'));

  breaker.on('timeout',  () => logger.warn({ servicio: 'AseguradoraAPI' },
    `Circuit Breaker: timeout de ${opciones.timeout}ms superado.`));

  breaker.on('reject',   () => logger.warn({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker: petición rechazada — circuito ABIERTO, conRetryYFallback devolverá fallback.'));

  return breaker;
}

module.exports = { crearCircuitBreaker };
