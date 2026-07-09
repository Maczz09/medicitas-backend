const logger = require('../../../../../shared/logger/logger');
const { maskTelefono } = require('../../../../../shared/infrastructure/pii');

class SMSMockAdapter {
  async enviar({ telefono, mensaje, idMensaje }) {
    logger.info({ telefono: maskTelefono(telefono), idMensaje, largo: mensaje.length },
      '[MOCK] Simulando envío de SMS');

    await this._simularLatencia(80, 250);

    if (telefono.startsWith('998')) {
      await this._simularLatencia(8000, 10000); // Supera el CB_TIMEOUT_MS
    }

    if (telefono.startsWith('999')) {
      throw new Error('[MOCK] Gateway SMS rechazó el número — inválido o bloqueado');
    }

    return {
      exitoso:   true,
      referencia: `MOCK-${Date.now()}`,
    };
  }

  async enviarPDFBase64({ telefono, base64Data, nombreArchivo, mensajeTexto }) {
    const kb = Math.round(((base64Data?.length || 0) * 0.75) / 1024);
    logger.info({ telefono: maskTelefono(telefono), nombreArchivo, kb },
      '[MOCK] Simulando envío de PDF adjunto por WhatsApp');

    await this._simularLatencia(80, 250);

    return {
      exitoso:    true,
      referencia: `MOCK-PDF-${Date.now()}`,
    };
  }

  _simularLatencia(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SMSMockAdapter };
