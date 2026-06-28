const logger = require('../../../../../shared/logger/logger');

const WHATSAPP_FROM   = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
const STATUS_CALLBACK = process.env.APP_PUBLIC_URL
  ? `${process.env.APP_PUBLIC_URL}/webhooks/twilio/status`
  : null;

function fmtWhatsApp(tel) {
  const digits = tel.replace(/\D/g, '');
  const e164   = digits.startsWith('51') ? `+${digits}` : `+51${digits}`;
  return `whatsapp:${e164}`;
}

class TwilioWhatsAppAdapter {
  constructor() {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    if (sid && token && sid.startsWith('AC')) {
      try {
        this.twilio = require('twilio')(sid, token);
        logger.info('[WA-Adapter] Twilio WhatsApp inicializado');
      } catch (e) {
        logger.warn('[WA-Adapter] No se pudo inicializar Twilio: ' + e.message);
        this.twilio = null;
      }
    } else {
      logger.warn('[WA-Adapter] Credenciales no configuradas — modo mock');
      this.twilio = null;
    }
  }

  async enviar({ telefono, mensaje, idMensaje }) {
    const destino = fmtWhatsApp(telefono);

    if (!this.twilio) {
      logger.info(`[WA-MOCK] → ${destino}: ${mensaje}`);
      return { exitoso: true, referencia: `MOCK-${Date.now()}` };
    }

    const params = {
      body: mensaje,
      from: WHATSAPP_FROM,
      to:   destino,
    };
    if (STATUS_CALLBACK) params.statusCallback = STATUS_CALLBACK;

    const msg = await this.twilio.messages.create(params);
    logger.info({ sid: msg.sid, destino, idMensaje }, '[WA-Adapter] Mensaje enviado');
    return { exitoso: true, referencia: msg.sid };
  }
}

module.exports = { TwilioWhatsAppAdapter };
