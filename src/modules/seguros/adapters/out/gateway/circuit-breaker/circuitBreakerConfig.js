const CircuitBreaker = require('opossum');
const logger = require('../../../../../../shared/logger/logger');

function crearCircuitBreaker(llamadaExterna) {
  const opciones = {
    timeout:                  parseInt(process.env.CB_TIMEOUT_MS     || '5000'),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD || '50'),
    resetTimeout:             parseInt(process.env.CB_RESET_TIMEOUT_MS|| '30000'),
    volumeThreshold:          5,      // Mínimo 5 peticiones antes de evaluar el umbral
    rollingCountTimeout:      10000,  // Ventana deslizante de 10s para contar errores
    rollingCountBuckets:      10,     // Granularidad de la ventana
  };

  const breaker = new CircuitBreaker(llamadaExterna, opciones);

  // ── Fallback: se ejecuta cuando el circuito está ABIERTO ──────────────────
  // Devuelve estado de contingencia sin lanzar error — el use case lo maneja
  breaker.fallback(() => ({
    estadoCobertura:     'PENDIENTE',
    porcentajeCobertura: 0,
    codigoAutorizacion:  null,
    vigencia:            null,
    esFallback:          true,        // Flag interno para identificar contingencias
  }));

  // ── Eventos del circuit breaker para observabilidad ───────────────────────
  breaker.on('open',     () => logger.warn({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker ABIERTO — API Aseguradora no disponible. Usando modo PENDIENTE.'));

  breaker.on('halfOpen', () => logger.info({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker SEMI-ABIERTO — Probando reconexión con API Aseguradora.'));

  breaker.on('close',    () => logger.info({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker CERRADO — API Aseguradora disponible nuevamente.'));

  breaker.on('fallback', (result) => logger.warn({ result, servicio: 'AseguradoraAPI' },
    'Circuit Breaker: fallback ejecutado. Cobertura queda en estado PENDIENTE.'));

  breaker.on('timeout',  () => logger.warn({ servicio: 'AseguradoraAPI' },
    `Circuit Breaker: timeout de ${opciones.timeout}ms superado.`));

  breaker.on('reject',   () => logger.warn({ servicio: 'AseguradoraAPI' },
    'Circuit Breaker: petición rechazada (circuito ABIERTO).'));

  return breaker;
}

module.exports = { crearCircuitBreaker };
