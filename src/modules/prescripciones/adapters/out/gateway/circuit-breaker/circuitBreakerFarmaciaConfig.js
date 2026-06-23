const CircuitBreaker = require('opossum');
const logger = require('../../../../../../shared/logger/logger');

function crearCircuitBreakerFarmacia(llamadaExterna) {
  const opciones = {
    timeout:                  parseInt(process.env.CB_TIMEOUT_MS_FARMACIA       || '5000'),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD_FARMACIA  || '50'),
    resetTimeout:             parseInt(process.env.CB_RESET_TIMEOUT_MS_FARMACIA || '30000'),
    volumeThreshold:          5,
    rollingCountTimeout:      10000,
    rollingCountBuckets:      10,
    // Errores de configuración (400/401) NO abren el circuito.
    // Se propagan hacia el caller pero no cuentan como falla de disponibilidad.
    errorFilter: (err) => err.esErrorDeConfiguracion === true,
  };

  const breaker = new CircuitBreaker(llamadaExterna, opciones);

  breaker.on('open',     () => logger.warn({ servicio: 'FarmaciaAPI' }, 'Circuit Breaker ABIERTO — API Farmacia no disponible.'));
  breaker.on('halfOpen', () => logger.info({ servicio: 'FarmaciaAPI' }, 'Circuit Breaker SEMI-ABIERTO — probando reconexión con Farmacia.'));
  breaker.on('close',    () => logger.info({ servicio: 'FarmaciaAPI' }, 'Circuit Breaker CERRADO — API Farmacia disponible nuevamente.'));
  breaker.on('timeout',  () => logger.warn({ servicio: 'FarmaciaAPI' }, `Circuit Breaker: timeout de ${opciones.timeout}ms superado.`));

  return breaker;
}

module.exports = { crearCircuitBreakerFarmacia };
