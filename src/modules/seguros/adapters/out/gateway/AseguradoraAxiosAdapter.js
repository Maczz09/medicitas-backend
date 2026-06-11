const axios = require('axios');
const { crearCircuitBreaker } = require('./circuit-breaker/circuitBreakerConfig');
const { RespuestaSanitizer }  = require('./sanitizer/RespuestaSanitizer');
const { DomainError }         = require('../../../../../shared/domain/errors');
const logger = require('../../../../../shared/logger/logger');

class AseguradoraAxiosAdapter {
  constructor() {
    // El Circuit Breaker envuelve la función de llamada HTTP
    this.breaker = crearCircuitBreaker(this._llamarApiExterna.bind(this));
  }

  // ── Punto de entrada: llamado por el use case ─────────────────────────────
  async validarPoliza(request) {
    try {
      const requestMapeado = this._mapearRequest(request);
      const respuestaRaw   = await this.breaker.fire(requestMapeado);
      const respuestaSana  = RespuestaSanitizer.sanitizar(respuestaRaw);
      return respuestaSana;
    } catch (err) {
      // El Circuit Breaker ya llamó al fallback si estaba abierto.
      // Si llega aquí, es un error no esperado del adaptador.
      logger.error({ err, request }, 'Error inesperado en AseguradoraAxiosAdapter');
      throw new DomainError('ERROR_ADAPTADOR_EXTERNO', 500,
        'Error interno al comunicarse con la aseguradora');
    }
  }

  // ── Llamada HTTP real (envuelta por el Circuit Breaker) ───────────────────
  async _llamarApiExterna(requestMapeado) {
    const url     = process.env.SEGURO_API_URL;
    const apiKey  = process.env.SEGURO_API_KEY;
    const timeout = parseInt(process.env.SEGURO_API_TIMEOUT || process.env.CB_TIMEOUT_MS || '5000');

    // Ajustar headers según la documentación del proveedor
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    logger.info({ url, timeout }, 'Llamando a API externa de aseguradora');

    const { data } = await axios.post(url, requestMapeado, { headers, timeout });
    return data;
  }

  // ── Mapeo: dominio MediCitas → formato del proveedor ─────────────────────
  _mapearRequest({ idPaciente, idAseguradora, numeroPoliza, tipoConsulta }) {
    // Formato placeholder mientras no hay contrato real
    return {
      idPaciente,
      idAseguradora,
      numeroPoliza,
      tipoConsulta,
    };
  }

  // ── Mapeo: respuesta del proveedor → formato MediCitas ───────────────────
  _mapearResponse(respuestaProveedor) {
    // Por ahora, se asume que el proveedor ya habla el mismo idioma (para el mock)
    return respuestaProveedor;
  }
}

module.exports = { AseguradoraAxiosAdapter };
