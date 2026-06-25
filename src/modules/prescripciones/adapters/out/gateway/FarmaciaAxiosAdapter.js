const axios = require('axios');
const http  = require('http');
const https = require('https');
const { crearCircuitBreakerFarmacia } = require('./circuit-breaker/circuitBreakerFarmaciaConfig');
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
   * - Si breaker.fire() rechaza (timeout, CB abierto, 5xx) → mapea a TRANSPORTE.
   */
  async enviarReceta({ idReceta, farmaciaId, medicamento, dosis, cantidad }) {
    try {
      return await this.breaker.fire({ idReceta, farmaciaId, medicamento, dosis, cantidad });
    } catch (err) {
      return this._mapearFalloATransporte(err);
    }
  }

  /**
   * Llamada HTTP real — envuelta por el Circuit Breaker.
   * La URL completa viene de la variable de entorno (incluyendo la ruta del endpoint).
   */
  async _llamadaReal({ idReceta, farmaciaId, medicamento, dosis, cantidad }) {
    logger.info({ idReceta, farmaciaId }, '[FarmaciaAxiosAdapter] Enviando receta a farmacia-api real');

    const response = await this.client.post(process.env.FARMACIA_API_URL, {
      referenciaDespacho: idReceta,
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
      const err = new Error(response.data?.motivo || `Error de cliente HTTP ${response.status} desde farmacia-api`);
      err.esErrorDeConfiguracion = true;
      throw err;
    }

    // Cualquier otro status (5xx, etc.) → falla real de disponibilidad.
    // SÍ se suma al porcentaje de fallas del Circuit Breaker.
    throw new Error(`farmacia-api respondió con estado HTTP inesperado: ${response.status}`);
  }

  /**
   * Convierte cualquier excepción en un resultado de tipo TRANSPORTE.
   * Distingue entre error de configuración y falla de disponibilidad.
   */
  _mapearFalloATransporte(err) {
    const motivo = err.esErrorDeConfiguracion
      ? `Error de configuración al llamar a farmacia-api: ${err.message}`
      : this.breaker.opened
        ? 'Circuito abierto: farmacia-api no ha respondido de forma consistente.'
        : `farmacia-api no respondió a tiempo (timeout ${process.env.CB_TIMEOUT_MS_FARMACIA || 5000}ms).`;

    logger.warn({ motivo, cbAbierto: this.breaker.opened }, '[FarmaciaAxiosAdapter] Fallo de transporte — receta no enviada');

    return {
      aceptada: false,
      referenciaFarmacia: null,
      motivoRechazo: motivo,
      origenFallo: 'TRANSPORTE',
    };
  }
}

module.exports = FarmaciaAxiosAdapter;
