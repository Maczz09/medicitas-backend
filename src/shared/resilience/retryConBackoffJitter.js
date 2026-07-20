'use strict';

const { trace } = require('@opentelemetry/api');
const {
  RETRY_SCHEDULE_MS,
  RETRY_JITTER_MS,
} = require('./config');
const { retryAttemptsCounter } = require('../../config/metrics');

// Mismo patrón que shared/infrastructure/correlation.middleware.js: anota el
// span HTTP/cliente activo (auto-instrumentado por axios) con el número de
// intento. NO se hace desde los eventos del Circuit Breaker (open/halfOpen/
// close) — esos disparan por transiciones agregadas, a veces desde un
// setTimeout interno de opossum sin ningún span de request en curso.
function anotarIntentoEnSpanActivo(intento) {
  trace.getActiveSpan()?.setAttribute('resiliencia.intento', intento);
}

/**
 * Calcula el delay para el intento N (1-based) con el horario FIJO del
 * docente (3s/5s/8s por defecto) ± jitter aleatorio. Reemplaza el Full
 * Jitter anterior (aleatorio 0..exponencial) — ver config.js para el
 * trade-off (peor caso más alto, a cambio de números literales
 * demostrables en logs/chaos-log).
 *
 * @param {number} intento — Número de intento actual (1-based)
 * @returns {number}        — Delay en ms, siempre >= 0
 */
function calcularBackoffSchedule(intento) {
  const idx = Math.min(intento, RETRY_SCHEDULE_MS.length) - 1;
  const base = RETRY_SCHEDULE_MS[idx];
  const jitter = (Math.random() * 2 - 1) * RETRY_JITTER_MS; // ± RETRY_JITTER_MS
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Determina si un error justifica un reintento.
 *
 * Solo son transitorios:
 *   - Errores de red (ECONNREFUSED, ECONNRESET, ETIMEDOUT, ECONNABORTED)
 *   - Respuestas 5xx del servidor (pueden ser temporales)
 *
 * NUNCA son transitorios:
 *   - Respuestas 4xx (problema en el dato enviado, no en la red)
 *   - Rechazo del Circuit Breaker abierto (EOPENBREAKER de opossum — no tiene
 *     .code de red ni .response, y su mensaje no contiene "timeout", así que
 *     cae aquí sin necesitar un caso especial: falla rápido sin desperdiciar
 *     intentos contra un circuito ya abierto)
 *   - Errores de programación
 *
 * @param {Error} err — El error capturado
 * @returns {boolean}
 */
function esErrorTransitorio(err) {
  const CODIGOS_RED_TRANSITORIOS = [
    'ECONNREFUSED',  // Servidor rechazó la conexión
    'ECONNRESET',    // Conexión reseteada por el servidor
    'ETIMEDOUT',     // Timeout de red
    'ECONNABORTED',  // Conexión abortada
    'ERR_NETWORK',   // Error de red genérico de axios
  ];

  if (err.code && CODIGOS_RED_TRANSITORIOS.includes(err.code)) return true;
  if (err.response && err.response.status >= 500)               return true;

  // Timeout de axios — el mensaje suele ser 'timeout of Xms exceeded'
  if (err.code === 'ECONNABORTED' || (err.message && err.message.includes('timeout'))) return true;

  return false; // 4xx, errores de programación, EOPENBREAKER, etc. → NO reintentar
}

function registrarResultado(nombreServicio, resultado) {
  retryAttemptsCounter.inc({ service: nombreServicio || 'desconocido', resultado });
}

/**
 * Ejecuta `intentarLlamada` con reintentos automáticos y fallback final.
 *
 * @param {Function} intentarLlamada   — (intento: number) => Promise<any> — la llamada a reintentar; recibe el número de intento (1-based) para que el caller arme su propio timeout exponencial (ver shared/resilience/config.js#obtenerTimeoutParaIntento)
 * @param {Function} circuitoAbierto   — () => boolean — retorna true si el CB está OPEN
 * @param {any}      respuestaFallback — Valor a devolver si se agotan los intentos
 * @param {object}   [opciones]
 * @param {number}   [opciones.maxIntentos]    — Máximo número de intentos (default: RETRY_SCHEDULE_MS.length)
 * @param {string}   [opciones.nombreServicio] — Label para medicitas_retry_attempts_total
 * @param {object}   [logger]                  — Logger opcional (con .info, .warn)
 * @returns {Promise<any>}
 */
async function conRetryYFallback(intentarLlamada, circuitoAbierto, respuestaFallback, opciones = {}, logger) {
  const { maxIntentos = RETRY_SCHEDULE_MS.length, nombreServicio } = opciones;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    // Si el circuit breaker ya está abierto, no gastar el timeout esperando
    if (circuitoAbierto()) {
      logger?.warn({ servicio: nombreServicio || 'Resiliencia' },
        'Circuit Breaker abierto — se omite el reintento, fallback inmediato.');
      registrarResultado(nombreServicio, 'agotado');
      return respuestaFallback;
    }

    try {
      anotarIntentoEnSpanActivo(intento);
      const resultado = await intentarLlamada(intento);
      registrarResultado(nombreServicio, intento === 1 ? 'exitoso_primer_intento' : 'exitoso_tras_reintento');
      return resultado;
    } catch (err) {
      const ultimoIntento = intento === maxIntentos;
      const reintentable  = esErrorTransitorio(err);

      if (!reintentable || ultimoIntento) {
        logger?.warn(
          { err: err.message, intento, reintentable },
          'Fallo definitivo — usando fallback.',
        );
        registrarResultado(nombreServicio, 'agotado');
        return respuestaFallback;
      }

      const delayMs = calcularBackoffSchedule(intento);
      logger?.info(
        { intento, delayMs, error: err.message },
        `Reintentando tras fallo transitorio (intento ${intento}/${maxIntentos}).`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Línea de seguridad — no debería alcanzarse, pero TypeScript agradece el return
  registrarResultado(nombreServicio, 'agotado');
  return respuestaFallback;
}

/**
 * Variante sin fallback: reintenta errores transitorios con el horario fijo
 * (config.js) y, si se agotan los intentos (o el error no es transitorio),
 * RELANZA el último error para que el caller conserve su manejo de errores
 * original.
 *
 * Pensada para los adaptadores S2S internos (Pacientes, Citas, Coberturas),
 * cuyos catch distinguen 404 de fallas de red — un fallback fijo rompería
 * esa semántica.
 *
 * @param {Function} intentarLlamada — (intento: number) => Promise<any>
 * @param {object}   [opciones]      — { maxIntentos, nombreServicio }
 * @param {object}   [logger]
 * @returns {Promise<any>}
 */
async function conReintentos(intentarLlamada, opciones = {}, logger) {
  const { maxIntentos = RETRY_SCHEDULE_MS.length, nombreServicio } = opciones;

  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      anotarIntentoEnSpanActivo(intento);
      const resultado = await intentarLlamada(intento);
      registrarResultado(nombreServicio, intento === 1 ? 'exitoso_primer_intento' : 'exitoso_tras_reintento');
      return resultado;
    } catch (err) {
      ultimoError = err;
      if (!esErrorTransitorio(err) || intento === maxIntentos) {
        registrarResultado(nombreServicio, 'agotado');
        throw err;
      }

      const delayMs = calcularBackoffSchedule(intento);
      logger?.info(
        { intento, delayMs, error: err.message },
        `Reintento tras fallo transitorio (intento ${intento}/${maxIntentos}).`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  registrarResultado(nombreServicio, 'agotado');
  throw ultimoError;
}

module.exports = { conRetryYFallback, conReintentos, esErrorTransitorio, calcularBackoffSchedule };
