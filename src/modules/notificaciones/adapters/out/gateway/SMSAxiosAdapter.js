const axios = require('axios');
const { crearCircuitBreakerSMS } = require('./circuit-breaker/smsCBConfig');
const { DomainError }            = require('../../../../../shared/domain/errors');
const logger = require('../../../../../shared/logger/logger');

class SMSAxiosAdapter {
  constructor() {
    this.breaker = crearCircuitBreakerSMS(this._llamarGateway.bind(this));
  }

  async enviar({ telefono, mensaje, idMensaje }) {
    try {
      const resultado = await this.breaker.fire({ telefono, mensaje, idMensaje });
      return resultado;
    } catch (err) {
      // El Circuit Breaker ya está abierto o falló la llamada
      // Propagar para que el use case lo trate como FALLIDO
      logger.error({ err, telefono }, 'SMSAxiosAdapter: fallo al enviar SMS');
      throw err;
    }
  }

  async _llamarGateway({ telefono, mensaje, idMensaje }) {
    const url    = process.env.SMS_GATEWAY_URL;
    const apiKey = process.env.SMS_GATEWAY_KEY;

    // TODO: Ajustar según la documentación del proveedor SMS
    const body = {
      // 'to':      telefono,      // Nombre del campo según el proveedor
      // 'message': mensaje,
      // 'from':    'MediCitas',
      // Formato placeholder:
      telefono,
      mensaje,
      referencia: idMensaje,
    };

    const { data } = await axios.post(url, body, {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: parseInt(process.env.CB_TIMEOUT_MS || '5000'),
    });

    // TODO: Mapear la respuesta del proveedor al contrato interno
    return {
      exitoso:    true, // data.status === 'sent' (según el proveedor)
      referencia: data.messageId || data.id || null,
    };
  }
}

module.exports = { SMSAxiosAdapter };
