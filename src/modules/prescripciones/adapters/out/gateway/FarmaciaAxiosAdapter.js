const axios = require('axios');
const http  = require('http');
const https = require('https');
const { crearCircuitBreakerFarmacia } = require('./circuit-breaker/circuitBreakerFarmaciaConfig');
const { conRetryYFallback } = require('../../../../../shared/resilience/retryConBackoffJitter');
const logger = require('../../../../../shared/logger/logger');

/**
 * FarmaciaAxiosAdapter — Gateway HTTP hacia la farmacia-api real.
 *
 * Contrato de retorno (SIEMPRE resuelve, nunca lanza):
 *   { aceptada, referenciaFarmacia, motivoRechazo, origenFallo }
 *
 * origenFallo:
 *   null          → receta aceptada (aceptada === true)
 *   'NEGOCIO'     → farmacia rechazó por stock/reglas de negocio (400 logic)
 *   'TRANSPORTE'  → timeout, CB abierto, 5xx — falla de disponibilidad
 *
 * Separar el origen permite al IniciarDespachoUseCase elegir entre
 * RECHAZADA_POR_STOCK y RECHAZADA_POR_VALIDACION sin lógica en el adaptador.
 */
class FarmaciaAxiosAdapter {
  constructor() {
    // Bulkhead: agente HTTP propio con maxSockets acotado — aísla este adaptador
    // del pool global de Node.js para que una caída de farmacia-api no agote
    // los sockets disponibles para el resto de llamadas salientes del proceso.
    this.client = axios.create({
      timeout: parseInt(process.env.CB_TIMEOUT_MS_FARMACIA || '5000') - 500,
      headers: { Authorization: `Bearer ${process.env.FARMACIA_API_KEY}` },
      validateStatus: () => true,
      httpAgent:  new http.Agent({ maxSockets: 20 }),
      httpsAgent: new https.Agent({ maxSockets: 20 }),
    });

    this.breaker = crearCircuitBreakerFarmacia(this._llamadaReal.bind(this));
    this._onRecuperacion = null;
    this.breaker.on('close', () => this._dispararRecuperacion());
  }

  registrarRecuperacion(fn) {
    this._onRecuperacion = fn;
  }

  async _dispararRecuperacion() {
    if (!this._onRecuperacion) return;
    try {
      await this._onRecuperacion();
    } catch (err) {
      logger.error({ err }, '[FarmaciaAxiosAdapter] Error en recovery replay tras cierre del circuito');
    }
  }

  /**
   * Punto de entrada público. Garantiza que NUNCA lanza:
   * - Si breaker.fire() resuelve → forwarda la respuesta.
   * - Fallos transitorios (timeout, 5xx) → retry con backoff exponencial + Full
   *   Jitter (misma pirámide de resiliencia que AseguradoraAxiosAdapter).
   * - Agotados los reintentos o CB abierto → fallback de tipo TRANSPORTE.
   *
   * Reintentar el POST es seguro: farmacia-api deduplica por referenciaDespacho
   * (idempotencia del lado del receptor).
   */
  async enviarReceta({ idReceta, farmaciaId, idEncuentroClinico, medicamento, dosis, cantidad }) {
    const datos = { idReceta, farmaciaId, idEncuentroClinico, medicamento, dosis, cantidad };

    return conRetryYFallback(
      () => this.breaker.fire(datos),
      () => this.breaker.opened,
      this._respuestaFallbackTransporte(),
      {
        maxIntentos: parseInt(process.env.RETRY_MAX_INTENTOS || '3'),
        baseMs:      parseInt(process.env.RETRY_BASE_MS      || '200'),
        maxMs:       parseInt(process.env.RETRY_MAX_MS       || '2000'),
      },
      logger,
    );
  }

  /**
   * Llamada HTTP real — envuelta por el Circuit Breaker.
   * La URL completa viene de la variable de entorno (incluyendo la ruta del endpoint).
   */
  async _llamadaReal({ idReceta, farmaciaId, idEncuentroClinico, medicamento, dosis, cantidad }) {
    logger.info({ idReceta, farmaciaId }, '[FarmaciaAxiosAdapter] Enviando receta a farmacia-api real');

    const response = await this.client.post(process.env.FARMACIA_API_URL, {
      referenciaDespacho: idReceta,
      idEncuentroClinico: idEncuentroClinico || null,
      farmacia: farmaciaId,
      medicamento,
      dosis,
      cantidad,
    });

    // 200: respuesta de negocio clara — aceptada o rechazada por stock.
    // Esto NUNCA debe contabilizarse como falla del Circuit Breaker.
    if (response.status === 200) {
      logger.info({ idReceta, aceptada: response.data.aceptada }, '[FarmaciaAxiosAdapter] Respuesta de negocio recibida');
      return response.data.aceptada
        ? {
            aceptada: true,
            referenciaFarmacia: response.data.referencia,
            motivoRechazo: null,
            origenFallo: null,
          }
        : {
            aceptada: false,
            referenciaFarmacia: null,
            motivoRechazo: response.data.motivo || 'Farmacia rechazó la receta sin motivo especificado',
            origenFallo: 'NEGOCIO',
          };
    }

    // 400/401: error de CONFIGURACIÓN de MediCitas (datos mal armados o API key rotada).
    // errorFilter los excluye del conteo de fallas del breaker, pero siguen propagándose.
    if (response.status === 400 || response.status === 401) {
      logger.warn({ idReceta, status: response.status }, '[FarmaciaAxiosAdapter] Error de configuración (no cuenta para CB)');
      const err = new Error(response.data?.mensaje || response.data?.motivo || `Error de cliente HTTP ${response.status} desde farmacia-api`);
      err.esErrorDeConfiguracion = true;
      throw err;
    }

    // Cualquier otro status (5xx, etc.) → falla real de disponibilidad.
    // SÍ se suma al porcentaje de fallas del Circuit Breaker.
    // Se adjunta response.status para que esErrorTransitorio() lo clasifique
    // como reintentable (los 5xx pueden ser temporales).
    const err = new Error(`farmacia-api respondió con estado HTTP inesperado: ${response.status}`);
    err.response = { status: response.status };
    throw err;
  }

  // ── Fallback: devuelto cuando se agotan reintentos o el circuito está abierto
  _respuestaFallbackTransporte() {
    return {
      aceptada: false,
      referenciaFarmacia: null,
      motivoRechazo: 'farmacia-api no disponible (timeout, 5xx o circuito abierto) — el despacho queda en cola y se reenviará automáticamente.',
      origenFallo: 'TRANSPORTE',
    };
  }
}

module.exports = FarmaciaAxiosAdapter;
