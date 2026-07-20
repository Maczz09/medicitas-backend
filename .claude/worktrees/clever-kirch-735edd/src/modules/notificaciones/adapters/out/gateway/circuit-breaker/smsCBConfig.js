const CircuitBreaker = require('opossum');
const logger = require('../../../../../../shared/logger/logger');

function crearCircuitBreakerSMS(llamadaExterna) {
  const opciones = {
    timeout:                  parseInt(process.env.CB_TIMEOUT_MS      || '5000'),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD  || '50'),
    resetTimeout:             parseInt(process.env.CB_RESET_TIMEOUT_MS || '30000'),
    volumeThreshold:          5,
    rollingCountTimeout:      10000,
  };

  const breaker = new CircuitBreaker(llamadaExterna, opciones);

  // NO hay fallback silencioso: si el CB está abierto, lanzamos error.
  // El use case registra el intento como FALLIDO y el consumer decide si NACK o DLQ.
  // A diferencia de Seguros (donde PENDIENTE era aceptable), un SMS no enviado
  // es simplemente un SMS fallido — no hay estado intermedio de negocio.
  breaker.on('open',     () => logger.warn({ servicio: 'SMSGateway' },
    'Circuit Breaker SMS ABIERTO — Gateway no disponible.'));
  breaker.on('halfOpen', () => logger.info({ servicio: 'SMSGateway' },
    'Circuit Breaker SMS SEMI-ABIERTO — Probando reconexión.'));
  breaker.on('close',    () => logger.info({ servicio: 'SMSGateway' },
    'Circuit Breaker SMS CERRADO — Gateway disponible nuevamente.'));

  return breaker;
}

module.exports = { crearCircuitBreakerSMS };
