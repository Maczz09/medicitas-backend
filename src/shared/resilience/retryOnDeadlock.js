'use strict';

const { retryAttemptsCounter } = require('../../config/metrics');

// Deadlock de InnoDB (1213 / ER_LOCK_DEADLOCK): patrón "check-then-insert"
// (SELECT ... FOR UPDATE seguido de INSERT) sobre un índice NO único, bajo
// REPEATABLE READ (default de MySQL). Cuando el SELECT no encuentra fila,
// InnoDB igual toma un gap lock sobre el hueco del índice para evitar
// phantom reads; dos transacciones concurrentes pueden tomar el MISMO gap
// lock sin bloquearse entre sí (los gap locks no son mutuamente excluyentes),
// pero luego chocan al pedir el insert-intention lock de su propio INSERT →
// espera circular → MySQL mata a una transacción automáticamente.
//
// El servidor ya hizo ROLLBACK completo de la transacción perdedora — no hay
// nada parcial que reanudar. Por eso `ejecutarTransaccion` debe encargarse de
// TODO el ciclo (BEGIN, trabajo, COMMIT/ROLLBACK) en cada intento, no de una
// query suelta.
//
// Schedule deliberadamente en milisegundos, NO el horario de segundos de
// retryConBackoffJitter.js (pensado para llamadas de red S2S): un deadlock
// ya se resolvió solo en el momento en que se detectó (la transacción
// ganadora sigue su curso, normalmente corta), así que conviene reintentar
// casi de inmediato en vez de esperar segundos.
function parseSchedule(env, fallback) {
  if (!env) return fallback;
  const valores = env.split(',').map((v) => parseInt(v.trim(), 10));
  if (valores.length === 0 || valores.some((v) => Number.isNaN(v))) return fallback;
  return valores;
}

const DEADLOCK_RETRY_SCHEDULE_MS = parseSchedule(process.env.DEADLOCK_RETRY_SCHEDULE_MS, [25, 75, 150]);
const DEADLOCK_RETRY_JITTER_MS = parseInt(process.env.DEADLOCK_RETRY_JITTER_MS || '20', 10);

function calcularBackoffDeadlock(intento) {
  const idx = Math.min(intento, DEADLOCK_RETRY_SCHEDULE_MS.length) - 1;
  const base = DEADLOCK_RETRY_SCHEDULE_MS[idx];
  const jitter = (Math.random() * 2 - 1) * DEADLOCK_RETRY_JITTER_MS; // ± jitter
  return Math.max(0, Math.round(base + jitter));
}

/**
 * @param {Error} err — error capturado (se espera el shape de mysql2)
 * @returns {boolean} true si err es específicamente un deadlock de InnoDB (1213)
 */
function esDeadlockMySQL(err) {
  return err?.code === 'ER_LOCK_DEADLOCK' || err?.errno === 1213;
}

function registrarResultado(nombreServicio, resultado) {
  retryAttemptsCounter.inc({ service: nombreServicio || 'desconocido', resultado });
}

/**
 * Reintenta una transacción MySQL completa cuando InnoDB la aborta por
 * deadlock (1213/ER_LOCK_DEADLOCK). Cualquier otro error (rechazos de
 * negocio, validaciones, etc.) se relanza de inmediato en el primer intento
 * — solo el deadlock es transitorio.
 *
 * @param {Function} ejecutarTransaccion — (intento: number) => Promise<any> — debe hacer BEGIN, el trabajo, y COMMIT/ROLLBACK; se reintenta desde cero
 * @param {object}   [opciones]
 * @param {number}   [opciones.maxIntentos]     — default: DEADLOCK_RETRY_SCHEDULE_MS.length
 * @param {string}   [opciones.nombreServicio]  — label para medicitas_retry_attempts_total
 * @param {object}   [logger]                   — logger opcional (.warn)
 * @returns {Promise<any>}
 */
async function conReintentoAnteDeadlock(ejecutarTransaccion, opciones = {}, logger) {
  const { maxIntentos = DEADLOCK_RETRY_SCHEDULE_MS.length, nombreServicio } = opciones;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      const resultado = await ejecutarTransaccion(intento);
      registrarResultado(nombreServicio, intento === 1 ? 'exitoso_primer_intento' : 'exitoso_tras_reintento');
      return resultado;
    } catch (err) {
      const ultimoIntento = intento === maxIntentos;
      const reintentable = esDeadlockMySQL(err);

      if (!reintentable || ultimoIntento) {
        registrarResultado(nombreServicio, 'agotado');
        throw err;
      }

      const delayMs = calcularBackoffDeadlock(intento);
      logger?.warn(
        { servicio: nombreServicio, intento, delayMs, err: err.message },
        `Deadlock de MySQL (1213) — reintentando transacción (intento ${intento}/${maxIntentos}).`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { conReintentoAnteDeadlock, esDeadlockMySQL, calcularBackoffDeadlock };
