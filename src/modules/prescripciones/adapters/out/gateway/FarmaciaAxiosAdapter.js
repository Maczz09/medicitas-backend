const axios = require('axios');
const http  = require('http');
const https = require('https');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { conRetryYFallback } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
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
 *
 * IMPORTANTE — esta clase se instancia DOS VECES en el proceso: una en
 * server.js (consumer real de RabbitMQ, el path que efectivamente despacha
 * recetas) y otra en prescripciones.routes.js (endpoint manual de
 * reintento). Cada instancia tiene su PROPIO circuit breaker — por eso el
 * constructor exige un nombreServicio explícito y distinto en cada call
 * site: si ambas reportaran el mismo nombre al gauge de Prometheus, se
 * pisarían entre sí y Grafana podría mostrar "sano" mientras una de las dos
 * rutas está realmente degradada.
 */
class FarmaciaAxiosAdapter {
  constructor({ nombreServicio = 'FarmaciaAPI' } = {}) {
    // Bulkhead: agente HTTP propio con maxSockets acotado — aísla este
    // adaptador del pool global de Node.js para que una caída de
    // farmacia-api no agote los sockets disponibles para el resto de
    // llamadas salientes del proceso. Sin timeout fijo: va por-request,
    // exponencial por intento (ver _llamadaReal).
    this.client = axios.create({
      headers: { Authorization: `Bearer ${process.env.FARMACIA_API_KEY}` },
      validateStatus: () => true,
      httpAgent:  new http.Agent({ maxSockets: 20 }),
      httpsAgent: new https.Agent({ maxSockets: 20 }),
    });

    this.nombreServicio = nombreServicio;
    const { breaker, registrarRecuperacion } = crearCircuitBreaker({
      nombreServicio,
      // Literal fijo a propósito, NO nombreServicio: esta clase tiene 2
      // instancias con nombreServicio distinto ('FarmaciaAPI-Despacho' /
      // '-Reintento') para no pisarse en el gauge de Prometheus — pero para
      // el usuario final ambas son "el servicio de Farmacia", un solo nombre
      // legible sin importar cuál instancia abrió el circuito.
      servicioAfectado: 'Farmacia',
      accion: this._llamadaReal.bind(this),
      // Errores de configuración (400/401) NO abren el circuito — se
      // propagan hacia el caller pero no cuentan como falla de disponibilidad.
      errorFilter: (err) => err.esErrorDeConfiguracion === true,
    });
    this.breaker = breaker;
    // Delega directo a la factory — antes cada adaptador reimplementaba su
    // propio _onRecuperacion/_dispararRecuperacion encima de breaker.on('close').
    this.registrarRecuperacion = registrarRecuperacion;
  }

  /**
   * Punto de entrada público. Garantiza que NUNCA lanza:
   * - Si breaker.fire() resuelve → forwarda la respuesta.
   * - Fallos transitorios (timeout, 5xx) → retry con horario fijo 3s/5s/8s
   *   (misma pirámide de resiliencia que AseguradoraAxiosAdapter).
   * - Agotados los reintentos o CB abierto → fallback de tipo TRANSPORTE.
   *
   * Reintentar el POST es seguro: farmacia-api deduplica por referenciaDespacho
   * (idempotencia del lado del receptor).
   */
  async enviarReceta({ idReceta, farmaciaId, idEncuentroClinico, medicamento, dosis, cantidad }) {
    const datos = { idReceta, farmaciaId, idEncuentroClinico, medicamento, dosis, cantidad };

    return conRetryYFallback(
      (intento) => this.breaker.fire(datos, intento),
      () => this.breaker.opened,
      this._respuestaFallbackTransporte(),
      { nombreServicio: this.nombreServicio },
      logger,
    );
  }

  /**
   * Llamada HTTP real — envuelta por el Circuit Breaker. `intento` (1-based)
   * lo reenvía opossum desde breaker.fire(datos, intento) — arma el timeout
   * exponencial de este intento específico. La URL completa viene de la
   * variable de entorno (incluyendo la ruta del endpoint).
   */
  async _llamadaReal({ idReceta, farmaciaId, idEncuentroClinico, medicamento, dosis, cantidad }, intento) {
    logger.info({ idReceta, farmaciaId }, '[FarmaciaAxiosAdapter] Enviando receta a farmacia-api real');

    const response = await this.client.post(process.env.FARMACIA_API_URL, {
      referenciaDespacho: idReceta,
      idEncuentroClinico: idEncuentroClinico || null,
      farmacia: farmaciaId,
      medicamento,
      dosis,
      cantidad,
    }, {
      timeout: obtenerTimeoutParaIntento(intento),
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
