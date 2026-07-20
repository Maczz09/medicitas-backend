'use strict';

const CircuitBreaker = require('opossum');
const logger = require('../logger/logger');
const {
  CB_TIMEOUT_MS,
  CB_ERROR_THRESHOLD_PERCENTAGE,
  CB_RESET_TIMEOUT_MS,
  CB_VOLUME_THRESHOLD,
  CB_ROLLING_COUNT_TIMEOUT_MS,
  CB_ROLLING_COUNT_BUCKETS,
} = require('./config');
const { circuitBreakerStateGauge } = require('../../config/metrics');

/**
 * Factory única de Circuit Breaker (opossum) para TODOS los adaptadores S2S
 * (internos y externos). Reemplaza los 2 archivos de config duplicados que
 * existían antes (uno por servicio externo, ~30 líneas cada uno) — mismas
 * constantes, mismos 4 eventos logueados, ahora en un solo lugar.
 *
 * IMPORTANTE — nombreServicio debe ser único por INSTANCIA real de breaker,
 * no por clase de adaptador: FarmaciaAxiosAdapter, por ejemplo, tiene 2
 * instancias vivas (una consumida por el consumer de RabbitMQ, otra por el
 * endpoint de reintento manual) — si ambas reportaran el mismo nombre, se
 * pisarían en el gauge y Grafana podría mostrar "sano" mientras una de las
 * dos rutas está realmente degradada.
 *
 * No manipula spans de OpenTelemetry: los eventos open/halfOpen/close de
 * opossum se disparan por transiciones agregadas — incluida la transición a
 * half-open, que ocurre por un setTimeout interno sin ningún request en
 * curso. Etiquetar un span aquí no tendría uno activo la mayoría de las
 * veces, o etiquetaría el de un request no relacionado. El atributo de
 * intento de reintento (resiliencia.intento) se setea en el closure de cada
 * llamada, no aquí.
 *
 * @param {object} opciones
 * @param {string} opciones.nombreServicio — label para logs y para
 *   medicitas_circuit_breaker_state.
 * @param {Function} opciones.accion — función que el breaker envuelve.
 * @param {Function} [opciones.errorFilter] — (err) => boolean; true = el
 *   error NO cuenta como falla del circuito (ej. 404 de negocio) pero sigue
 *   propagándose al caller igual. Debe reflejar lo que el catch del
 *   adaptador YA decide, no una regla nueva.
 * @param {number} [opciones.cbTimeoutMs] — override del timeout interno de
 *   opossum (default: CB_TIMEOUT_MS). Necesario solo cuando el adaptador usa
 *   su PROPIO horario de timeout más alto que el genérico (ej. descargas de
 *   PDF) — debe superar el último valor de ESE horario, no el genérico.
 * @param {string} [opciones.servicioAfectado] — nombre legible para mostrar
 *   al usuario final en el banner de resiliencia del frontend (ej. "Citas"
 *   en vez de "Pagos→Citas:consultar"). Default: nombreServicio. Casi
 *   siempre coincide con el nombreServicio de los adaptadores de UN solo
 *   método — solo diverge cuando nombreServicio es dinámico o compuesto
 *   (ver FarmaciaAxiosAdapter, que pasa un literal fijo 'Farmacia' porque
 *   nombreServicio varía según la instancia).
 * @returns {{ breaker: CircuitBreaker, registrarRecuperacion: Function }}
 */
function crearCircuitBreaker({ nombreServicio, accion, errorFilter, cbTimeoutMs, servicioAfectado }) {
  const servicioLegible = servicioAfectado || nombreServicio;
  const opcionesBreaker = {
    timeout: cbTimeoutMs || CB_TIMEOUT_MS,
    errorThresholdPercentage: CB_ERROR_THRESHOLD_PERCENTAGE,
    resetTimeout: CB_RESET_TIMEOUT_MS,
    volumeThreshold: CB_VOLUME_THRESHOLD,
    rollingCountTimeout: CB_ROLLING_COUNT_TIMEOUT_MS,
    rollingCountBuckets: CB_ROLLING_COUNT_BUCKETS,
    errorFilter,
  };

  const breaker = new CircuitBreaker(accion, opcionesBreaker);

  // Semilla en 0 (Cerrado) al construir — sin esto, un servicio que nunca
  // falla queda en "no data" en Grafana en vez de mostrar "sano" desde el
  // arranque (antes solo AseguradoraAPI se semillaba a mano en metrics.js).
  circuitBreakerStateGauge.set({ service: nombreServicio }, 0);

  // Notifica por el canal de tiempo real ya existente (ver
  // shared/infrastructure/realtime.routes.js) — require LAZY a propósito:
  // ese módulo corre un setInterval de ping sin unref() a nivel de módulo, y
  // requerirlo al tope arrastraría ese timer al require-graph de los 13
  // adaptadores que usan esta factory (y sus tests). Sin ciclo de imports
  // (confirmado): realtime.routes.js no toca nada de shared/resilience/.
  // Solo open/close — no halfOpen, para no complicar el estado que ve el
  // usuario con una transición intermedia sin valor pedagógico adicional.
  function emitir(tipo) {
    try {
      const { emitirEventoOperacional } = require('../infrastructure/realtime.routes');
      emitirEventoOperacional(tipo, { servicio: servicioLegible, nombreTecnico: nombreServicio });
    } catch (e) {
      logger.warn({ err: e.message, tipo, servicio: servicioLegible }, '[CircuitBreaker] No se pudo emitir el evento de tiempo real');
    }
  }

  breaker.on('open', () => {
    logger.warn({ servicio: nombreServicio },
      `Circuit Breaker ABIERTO para ${nombreServicio} — demasiados fallos. Próximas llamadas van directo al fallback.`);
    circuitBreakerStateGauge.set({ service: nombreServicio }, 1);
    emitir('CircuitBreakerAbierto');
  });

  breaker.on('halfOpen', () => {
    logger.info({ servicio: nombreServicio },
      `Circuit Breaker SEMI-ABIERTO para ${nombreServicio} — probando reconexión.`);
    circuitBreakerStateGauge.set({ service: nombreServicio }, 2);
  });

  breaker.on('close', () => {
    logger.info({ servicio: nombreServicio },
      `Circuit Breaker CERRADO para ${nombreServicio} — servicio disponible nuevamente.`);
    circuitBreakerStateGauge.set({ service: nombreServicio }, 0);
    emitir('CircuitBreakerCerrado');
  });

  breaker.on('timeout', () => {
    logger.warn({ servicio: nombreServicio },
      `Circuit Breaker: timeout de ${opcionesBreaker.timeout}ms superado para ${nombreServicio}.`);
  });

  // Self-healing: se dispara solo cuando el circuito cierra (la sonda de
  // half-open funcionó). registrarRecuperacion() es opcional — adaptadores
  // sin estado "pendiente" que reprocesar (la mayoría de los internos) no
  // la usan, y su auto-recuperación queda cubierta por el propio ciclo de
  // opossum (medio-abre a los 30s, cierra solo si la sonda funciona).
  let onRecuperacion = null;
  breaker.on('close', () => {
    if (!onRecuperacion) return;
    Promise.resolve(onRecuperacion()).catch((err) => {
      logger.error({ servicio: nombreServicio, err: err.message },
        `Error en recovery replay tras cierre del circuito de ${nombreServicio}`);
    });
  });

  function registrarRecuperacion(fn) {
    onRecuperacion = fn;
  }

  return { breaker, registrarRecuperacion };
}

module.exports = { crearCircuitBreaker };
