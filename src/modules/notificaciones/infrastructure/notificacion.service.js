const logger = require('../../../shared/logger/logger');

const WHATSAPP_FROM   = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
const STATUS_CALLBACK = process.env.APP_PUBLIC_URL
  ? `${process.env.APP_PUBLIC_URL}/webhooks/twilio/status`
  : null;

function fmtWhatsApp(tel) {
  if (!tel) return null;
  const digits = tel.replace(/\D/g, '');
  const e164 = digits.startsWith('51') ? `+${digits}` : `+51${digits}`;
  return `whatsapp:${e164}`;
}

class NotificacionService {
  constructor() {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (sid && token && sid.startsWith('AC')) {
      try {
        this.twilio = require('twilio')(sid, token);
        logger.info('[WA] Twilio inicializado correctamente');
      } catch (e) {
        logger.warn('[WA] No se pudo inicializar Twilio: ' + e.message);
        this.twilio = null;
      }
    } else {
      logger.warn('[WA] Credenciales Twilio no configuradas — modo mock');
      this.twilio = null;
    }
  }

  async enviarSMS(telefono, mensaje) {
    const destino = fmtWhatsApp(telefono);
    if (!destino) {
      logger.warn('[WA] Teléfono inválido o vacío — omitiendo');
      return;
    }

    if (!this.twilio) {
      logger.info(`[WA-MOCK] → ${destino}: ${mensaje}`);
      return;
    }

    try {
      const params = { body: mensaje, from: WHATSAPP_FROM, to: destino };
      if (STATUS_CALLBACK) params.statusCallback = STATUS_CALLBACK;
      const msg = await this.twilio.messages.create(params);
      logger.info({ sid: msg.sid, destino }, '[WA] Enviado correctamente');
    } catch (err) {
      logger.error({ err: err.message, destino }, '[WA] Error al enviar');
      throw err;
    }
  }

  async enviarEmail(correo, asunto, cuerpo) {
    logger.info({ correo, asunto }, '[Email] (mock)');
  }
}

module.exports = NotificacionService;
