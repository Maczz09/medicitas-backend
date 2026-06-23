const CircuitBreaker = require('opossum');
const logger = require('../../../../../../shared/logger/logger');

function crearCircuitBreaker(llamadaExterna) {
  const opciones = {
    timeout:                  parseInt(process.env.CB_TIMEOUT_MS_FARMACIA      || '5000'),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD_FARMACIA || '50'),
    resetTimeout:             parseInt(process.env.CB_RESET_TIMEOUT_MS_FARMACIA|| '30000'),
    volumeThreshold:          5,
    rollingCountTimeout:      10000,
    rollingCountBuckets:      10,
  };

  const breaker = new CircuitBreaker(llamadaExterna, opciones);

  // Fallback: el circuito está ABIERTO — no se intenta la llamada real.
  // El despacho permanece en CREADA, listo para reintentar más tarde.
  breaker.fallback(() => ({
    estado: 'RECHAZADA',
    motivoRechazo: 'Farmacia no disponible temporalmente (Circuit Breaker abierto)',
    esFallback: true,
  }));

  breaker.on('open',     () => logger.warn({ servicio: 'FarmaciaAPI' },
    'Circuit Breaker ABIERTO — API Farmacia no disponible.'));
  breaker.on('halfOpen', () => logger.info({ servicio: 'FarmaciaAPI' },
    'Circuit Breaker SEMI-ABIERTO — probando reconexión con Farmacia.'));
  breaker.on('close',    () => logger.info({ servicio: 'FarmaciaAPI' },
    'Circuit Breaker CERRADO — API Farmacia disponible nuevamente.'));
  breaker.on('fallback', (result) => logger.warn({ result, servicio: 'FarmaciaAPI' },
    'Circuit Breaker: fallback ejecutado. Despacho queda RECHAZADA, reintentable.'));
  breaker.on('timeout',  () => logger.warn({ servicio: 'FarmaciaAPI' },
    `Circuit Breaker: timeout de ${opciones.timeout}ms superado.`));

  return breaker;
}

module.exports = { crearCircuitBreaker };
