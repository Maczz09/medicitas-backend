const axios = require('axios');
const { crearCircuitBreaker }   = require('./circuit-breaker/circuitBreakerConfig');
const { conRetryYFallback }     = require('../../../../../shared/resilience/retryConBackoffJitter');
const { RespuestaSanitizer }    = require('./sanitizer/RespuestaSanitizer');
const logger = require('../../../../../shared/logger/logger');

/**
 * AseguradoraAxiosAdapter — Gateway HTTP hacia aseguradora-prosalud-api.
 *
 * Stack de resiliencia (de más interna a más externa):
 *
 *   axios.create({ timeout: 3000 })     ← capa 1: timeout por intento
 *     └─► breaker.fire()                ← capa 2: circuit breaker (sin .fallback())
 *           └─► conRetryYFallback()     ← capa 3: retry con Full Jitter + fallback final
 *
 * Esta clase NUNCA lanza excepción por "la aseguradora está caída".
 * Siempre resuelve: con el resultado real, o con el fallback { esFallback: true }.
 * ValidarCoberturaUseCase no necesita cambios — sigue recibiendo siempre un objeto válido.
 *
 * Contrato del endpoint externo:
 *   GET /api/v1/asegurados/validar?tipoDocumento=DNI&numeroDocumento=12345678
 *   Header: X-Api-Key: <clave>
 */
class AseguradoraAxiosAdapter {
  constructor() {
    // Cliente HTTP con timeout propio — debe ser MENOR que CB_TIMEOUT_MS
    // para que opossum mida tiempos consistentes. Ver circuitBreakerConfig.js.
    this.client = axios.create({
      baseURL: process.env.ASEGURADORA_API_URL || 'http://localhost:4001/api/v1',
      timeout: parseInt(process.env.HTTP_TIMEOUT_MS || '3000'),
      headers: { 'X-Api-Key': process.env.ASEGURADORA_API_KEY },
    });

    // El breaker envuelve _llamadaReal — sin .fallback() registrado en él
    this.breaker = crearCircuitBreaker(this._llamadaReal.bind(this));
  }

  // ── Punto de entrada: llamado por ValidarCoberturaUseCase ─────────────────
  // El use case llama validarPoliza() con { idPaciente, idAseguradora, numeroPoliza, tipoConsulta }.
  // Este adaptador mapea a los params del endpoint externo y devuelve el formato que
  // el use case espera — el mapeo es transparente para las capas superiores.
  async validarPoliza({ idPaciente, idAseguradora, numeroPoliza, tipoConsulta }) {
    // ── Mapeo de parámetros del use case al contrato del servidor Seguros ────
    // En producción, tipoDocumento y numeroDocumento vendrían del perfil del paciente.
    // Por ahora: tipoConsulta = tipoDocumento, numeroPoliza = numeroDocumento.
    // Este mapeo vive aquí — el use case nunca sabe del contrato externo.
    const datos = {
      tipoDocumento:   tipoConsulta,
      numeroDocumento: numeroPoliza,
    };

    return conRetryYFallback(
      () => this.breaker.fire(datos),
      () => this.breaker.opened,
      this._respuestaFallback(),
      {
        maxIntentos: parseInt(process.env.RETRY_MAX_INTENTOS || '3'),
        baseMs:      parseInt(process.env.RETRY_BASE_MS      || '200'),
        maxMs:       parseInt(process.env.RETRY_MAX_MS       || '2000'),
      },
      logger,
    );
  }

  // ── Llamada HTTP real (envuelta por el Circuit Breaker) ───────────────────
  async _llamadaReal({ tipoDocumento, numeroDocumento }) {
    logger.info({ tipoDocumento, numeroDocumento }, '[AseguradoraAxiosAdapter] Llamando a API Aseguradora');

    const { data } = await this.client.get('/asegurados/validar', {
      params: { tipoDocumento, numeroDocumento },
    });

    // Si el servidor devuelve asegurado: false → RECHAZADA (sin póliza vigente)
    if (!data.asegurado) {
      return {
        estadoCobertura:     'RECHAZADA',
        porcentajeCobertura: 0,
        codigoAutorizacion:  null,
        vigencia:            null,
        motivoRechazo:       'No se encontró póliza vigente para este documento',
      };
    }

    // Respuesta exitosa — sanitizar antes de devolver al use case
    const respuestaMapeada = {
      estadoCobertura:     'APROBADA',
      porcentajeCobertura: data.porcentajeCobertura,
      codigoAutorizacion:  `AUT-${data.numeroPoliza}-${Date.now()}`,
      vigencia:            data.vigencia?.fechaFin || null,
    };

    return RespuestaSanitizer.sanitizar(respuestaMapeada);
  }

  // ── Fallback: devuelto cuando se agotan reintentos o el circuito está abierto
  _respuestaFallback() {
    return {
      estadoCobertura:     'PENDIENTE',
      porcentajeCobertura: 0,
      codigoAutorizacion:  null,
      vigencia:            null,
      esFallback:          true, // Flag para identificar contingencias en el use case
    };
  }
}

module.exports = { AseguradoraAxiosAdapter };

