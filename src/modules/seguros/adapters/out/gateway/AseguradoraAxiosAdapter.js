const axios = require('axios');
const http  = require('http');
const https = require('https');
const { crearCircuitBreaker }   = require('../../../../../shared/resilience/circuitBreaker');
const { conRetryYFallback }     = require('../../../../../shared/resilience/retryConBackoffJitter');
const { obtenerTimeoutParaIntento } = require('../../../../../shared/resilience/config');
const { RespuestaSanitizer }    = require('./sanitizer/RespuestaSanitizer');
const logger = require('../../../../../shared/logger/logger');
const { maskDocumento } = require('../../../../../shared/infrastructure/pii');

// Cliente hacia seguros-fallback-service (cache-aside de pólizas) — best-effort
// en ambas direcciones (escritura y lectura), nunca bloquea ni rompe el flujo
// principal si el servicio de fallback también está caído.
const fallbackClient = axios.create({
  baseURL: process.env.SEGUROS_FALLBACK_URL || 'http://localhost:4010',
  timeout: parseInt(process.env.SEGUROS_FALLBACK_TIMEOUT_MS || '1500'),
  headers: { Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}` },
});

/**
 * AseguradoraAxiosAdapter — Gateway HTTP hacia aseguradora-prosalud-api.
 *
 * Stack de resiliencia (de más interna a más externa):
 *
 *   axios (sin timeout fijo, bulkhead maxSockets:20)
 *     └─► breaker.fire(datos, intento)   ← capa 2: circuit breaker (sin .fallback())
 *           └─► conRetryYFallback()      ← capa 3: retry con horario fijo 3s/5s/8s + fallback final
 *
 * El timeout de axios es EXPONENCIAL por intento (2s/4s/8s, ver
 * shared/resilience/config.js#obtenerTimeoutParaIntento) — cada reintento es
 * un nuevo breaker.fire(), así que cada uno arma su propio timeout.
 *
 * Esta clase NUNCA lanza excepción por "la aseguradora está caída".
 * Siempre resuelve: con el resultado real, o con el fallback { esFallback: true }.
 * ValidarCoberturaUseCase no necesita cambios — sigue recibiendo siempre un objeto válido.
 *
 * Contrato del endpoint externo:
 *   GET /api/v2/asegurados/validar?tipoDocumento=DNI&numeroDocumento=12345678
 *   Header: X-Api-Key: <clave>
 */
class AseguradoraAxiosAdapter {
  constructor() {
    // Bulkhead: agente HTTP propio — aísla los sockets de seguros del pool
    // global. Sin timeout fijo: va por-request, exponencial por intento.
    this.client = axios.create({
      baseURL: process.env.ASEGURADORA_API_URL || 'http://localhost:4001/api/v2',
      headers: { 'X-Api-Key': process.env.ASEGURADORA_API_KEY },
      httpAgent:  new http.Agent({ maxSockets: 20 }),
      httpsAgent: new https.Agent({ maxSockets: 20 }),
    });

    const { breaker, registrarRecuperacion } = crearCircuitBreaker({
      nombreServicio: 'AseguradoraAPI',
      servicioAfectado: 'Aseguradora',
      accion: this._llamadaReal.bind(this),
      // Sin errorFilter: igual que antes de este refactor, cualquier error
      // (incluidos 4xx) cuenta para el umbral del circuito — _llamadaReal no
      // distingue errores de configuración de fallas de disponibilidad.
    });
    this.breaker = breaker;
    // Delega directo a la factory — antes cada adaptador reimplementaba su
    // propio _onRecuperacion/_dispararRecuperacion encima de breaker.on('close').
    this.registrarRecuperacion = registrarRecuperacion;
  }

  // ── Punto de entrada: llamado por ValidarCoberturaUseCase ─────────────────
  // El use case llama validarPoliza() con { idPaciente, idAseguradora, numeroPoliza, tipoConsulta }.
  // Este adaptador mapea a los params del endpoint externo y devuelve el formato que
  // el use case espera — el mapeo es transparente para las capas superiores.
  async validarPoliza({ idPaciente, idAseguradora, numeroPoliza, tipoConsulta }) {
    // ── Mapeo de parámetros del use case al contrato del servidor Seguros ────
    // El servidor de la aseguradora valida por documento de identidad
    // (tipoDocumento ∈ DNI|CE|PASAPORTE). La recepción ingresa el número de
    // documento en `numeroPoliza`; aquí inferimos el tipo a partir del formato.
    // (En producción esto vendría del perfil del paciente.)
    const datos = {
      tipoDocumento:   this._inferirTipoDocumento(numeroPoliza),
      numeroDocumento: numeroPoliza,
    };

    const resultado = await conRetryYFallback(
      (intento) => this.breaker.fire(datos, intento),
      () => this.breaker.opened,
      this._respuestaFallback(),
      { nombreServicio: 'AseguradoraAPI' },
      logger,
    );

    // El fallback estático de conRetryYFallback (PENDIENTE genérico) es la red
    // de seguridad final. Antes de conformarnos con "no sé", intentamos
    // mejorarlo con seguros-fallback-service: si ese paciente ya fue validado
    // exitosamente antes, podemos responder con datos reales en vez de un
    // PENDIENTE ciego. Si el servicio de fallback también falla o no tiene el
    // dato, el PENDIENTE original se conserva sin cambios.
    if (resultado.esFallback) {
      const mejorado = await this._consultarCacheFallback(datos.tipoDocumento, datos.numeroDocumento);
      if (mejorado) return mejorado;
    }

    return resultado;
  }

  /** Lectura best-effort del cache — nunca lanza, nunca bloquea más de SEGUROS_FALLBACK_TIMEOUT_MS. */
  async _consultarCacheFallback(tipoDocumento, numeroDocumento) {
    try {
      const { data } = await fallbackClient.get(`/interno/polizas-cache/${tipoDocumento}/${numeroDocumento}`);
      if (!data.encontrado) return null;

      if (data.vigente) {
        return {
          estadoCobertura:     'APROBADA',
          porcentajeCobertura: data.porcentajeCobertura,
          codigoAutorizacion:  null, // no hay código de autorización real: viene de caché, no de la aseguradora en vivo
          // seguros-fallback-service serializa su columna DATE como Date de JS
          // → JSON la convierte a ISO completo ("...T00:00:00.000Z"). La
          // columna `vigencia` de este lado es DATE puro y ese formato le
          // provoca ER_TRUNCATED_WRONG_VALUE al insertar — silencioso, porque
          // CoberturasMySQLRepository.save() traga el error real. Normalizamos
          // a YYYY-MM-DD aquí, igual que ya hace findById() al leer.
          vigencia:            data.fechaFin ? new Date(data.fechaFin).toISOString().split('T')[0] : null,
          esFallback:          true,
          origenFallback:      'CACHE',
        };
      }
      return {
        estadoCobertura:     'RECHAZADA',
        porcentajeCobertura: 0,
        codigoAutorizacion:  null,
        vigencia:            null,
        esFallback:          true,
        origenFallback:      'CACHE_VENCIDA',
      };
    } catch (err) {
      logger.warn({ err: err.message }, '[AseguradoraAxiosAdapter] seguros-fallback-service no disponible — se mantiene el PENDIENTE genérico');
      return null;
    }
  }

  /** Escritura best-effort del cache tras una validación real exitosa — nunca bloquea ni lanza. */
  _cachearBestEffort({ tipoDocumento, numeroDocumento, idAseguradora, data }) {
    fallbackClient.put('/interno/polizas-cache', {
      tipoDocumento,
      numeroDocumento,
      idAseguradora: idAseguradora || 'aseguradora-prosalud',
      numeroPoliza: data.numeroPoliza,
      plan: data.plan,
      porcentajeCobertura: data.porcentajeCobertura,
      fechaInicio: data.vigencia?.fechaInicio,
      fechaFin: data.vigencia?.fechaFin,
      estadoPoliza: 'VIGENTE',
    }).catch((err) => {
      logger.warn({ err: err.message }, '[AseguradoraAxiosAdapter] No se pudo cachear en seguros-fallback-service (no bloquea la respuesta)');
    });
  }

  // Infiere el tipo de documento por el formato del número:
  //   8 dígitos → DNI · 9 alfanuméricos con letras → CE · resto → PASAPORTE
  _inferirTipoDocumento(numero) {
    const v = String(numero || '').trim();
    if (/^\d{8}$/.test(v)) return 'DNI';
    if (/^CE/i.test(v) || (/^[A-Za-z0-9]{9}$/.test(v) && /[A-Za-z]/.test(v))) return 'CE';
    return 'PASAPORTE';
  }

  // ── Llamada HTTP real (envuelta por el Circuit Breaker) ───────────────────
  // `intento` (1-based) lo reenvía opossum desde breaker.fire(datos, intento)
  // — arma el timeout exponencial de este intento específico.
  async _llamadaReal({ tipoDocumento, numeroDocumento }, intento) {
    logger.info({ tipoDocumento, numeroDocumento: maskDocumento(numeroDocumento) }, '[AseguradoraAxiosAdapter] Llamando a API Aseguradora');

    const { data } = await this.client.get('/asegurados/validar', {
      params: { tipoDocumento, numeroDocumento },
      timeout: obtenerTimeoutParaIntento(intento),
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

    // Cache-aside: validación real y exitosa — se cachea best-effort para que
    // un futuro fallback (circuit breaker abierto) pueda responder con datos
    // reales en vez de un PENDIENTE genérico. No bloquea ni puede fallar esta
    // respuesta (fire-and-forget).
    this._cachearBestEffort({ tipoDocumento, numeroDocumento, data });

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
