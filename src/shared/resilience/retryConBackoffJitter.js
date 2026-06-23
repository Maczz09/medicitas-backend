'use strict';

/**
 * retryConBackoffJitter.js — Shared Resilience Module
 *
 * Implementa el algoritmo "Full Jitter" descrito en el artículo de referencia
 * de AWS Architecture Blog ("Exponential Backoff and Jitter", Marc Brooker).
 *
 * En vez de esperar EXACTAMENTE 2^intento × base entre reintentos, se espera
 * un valor ALEATORIO entre 0 y ese máximo. Esto desincroniza a todos los
 * clientes que fallaron al mismo tiempo, evitando el "thundering herd" —
 * la ráfaga sincronizada que volvería a tumbar el servicio justo cuando
 * se está recuperando.
 *
 * ─── Capas de la pirámide de resiliencia ─────────────────────────────────────
 *
 *   conRetryYFallback()          ← capa más externa: decide reintentar o fallback
 *     └─► breaker.fire()         ← capa media: circuit breaker (sin .fallback() registrado)
 *           └─► axios.get(...)   ← capa más interna: timeout de la llamada real
 *
 * ─── Por qué los errores 4xx NUNCA se reintentan ─────────────────────────────
 *
 *   Un 400 Bad Request no lo arregla el tiempo — el problema es el dato enviado.
 *   Reintentar un 4xx es desperdicio de recursos y puede ocultar bugs en el cliente.
 *   esErrorTransitorio() traza esa línea con precisión.
 *
 * ─── Módulo reutilizable ──────────────────────────────────────────────────────
 *
 *   Este archivo vive en `src/shared/resilience/` y puede ser importado por
 *   cualquier gateway HTTP del proyecto (Farmacia, Notificaciones, etc.)
 *   sin copiar lógica de resiliencia en cada adaptador.
 */

/**
 * Calcula el delay con Full Jitter.
 *
 * @param {number} intento   — Número de intento actual (1-based)
 * @param {number} baseMs    — Tiempo base en ms (ej: 200)
 * @param {number} maxMs     — Cap máximo en ms (ej: 2000)
 * @returns {number}          — Delay aleatorio en ms entre 0 y min(maxMs, base × 2^(intento-1))
 */
function calcularBackoffConJitter(intento, baseMs, maxMs) {
  const backoffExponencial = Math.min(maxMs, baseMs * (2 ** (intento - 1)));
  return Math.random() * backoffExponencial; // Full Jitter
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

  return false; // 4xx, errores de programación, etc. → NO reintentar
}

/**
 * Ejecuta `intentarLlamada` con reintentos automáticos y fallback final.
 *
 * @param {Function} intentarLlamada   — () => Promise<any> — la llamada a reintentar
 * @param {Function} circuitoAbierto   — () => boolean — retorna true si el CB está OPEN
 * @param {any}      respuestaFallback — Valor a devolver si se agotan los intentos
 * @param {object}   [opciones]
 * @param {number}   [opciones.maxIntentos=3]  — Máximo número de intentos
 * @param {number}   [opciones.baseMs=200]      — Tiempo base para el backoff
 * @param {number}   [opciones.maxMs=2000]      — Cap máximo del backoff
 * @param {object}   [logger]                   — Logger opcional (con .info, .warn)
 * @returns {Promise<any>}
 */
async function conRetryYFallback(intentarLlamada, circuitoAbierto, respuestaFallback, opciones = {}, logger) {
  const { maxIntentos = 3, baseMs = 200, maxMs = 2000 } = opciones;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    // Si el circuit breaker ya está abierto, no gastar el timeout esperando
    if (circuitoAbierto()) {
      logger?.warn({ servicio: 'Resiliencia' },
        'Circuit Breaker abierto — se omite el reintento, fallback inmediato.');
      return respuestaFallback;
    }

    try {
      return await intentarLlamada();
    } catch (err) {
      const ultimoIntento = intento === maxIntentos;
      const reintentable  = esErrorTransitorio(err);

      if (!reintentable || ultimoIntento) {
        logger?.warn(
          { err: err.message, intento, reintentable },
          'Fallo definitivo — usando fallback.',
        );
        return respuestaFallback;
      }

      const delayMs = calcularBackoffConJitter(intento, baseMs, maxMs);
      logger?.info(
        { intento, delayMs: Math.round(delayMs), error: err.message },
        `Reintentando tras fallo transitorio (intento ${intento}/${maxIntentos}).`,
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Línea de seguridad — no debería alcanzarse, pero TypeScript agradece el return
  return respuestaFallback;
}

module.exports = { conRetryYFallback, esErrorTransitorio, calcularBackoffConJitter };
