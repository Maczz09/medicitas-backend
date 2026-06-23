const logger = require('../../../../../shared/logger/logger');

class SMSMockAdapter {
  async enviar({ telefono, mensaje, idMensaje }) {
    logger.info({ telefono, idMensaje, largo: mensaje.length },
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

  _simularLatencia(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SMSMockAdapter };
