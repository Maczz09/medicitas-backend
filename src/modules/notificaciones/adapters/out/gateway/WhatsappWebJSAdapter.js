const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeLib = require('qrcode');
const logger = require('../../../../../shared/logger/logger');
const axios = require('axios');

const STATUS_CALLBACK = process.env.APP_PUBLIC_URL
  ? `${process.env.APP_PUBLIC_URL}/api/v1/webhooks/twilio/status`
  : null;

function fmtWhatsApp(tel) {
  const digits = tel.replace(/\D/g, '');
  const e164   = digits.startsWith('51') ? `51${digits}` : `51${digits}`; // Perú code fallback
  return `${e164}@c.us`; // Formato requerido por whatsapp-web.js
}

class WhatsAppNotLinkedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WhatsAppNotLinkedError';
  }
}

class WhatsappWebJSAdapter {
  static instance = null;

  constructor(onReadyCallback) {
    if (WhatsappWebJSAdapter.instance) {
      return WhatsappWebJSAdapter.instance;
    }
    WhatsappWebJSAdapter.instance = this;

    this.onReadyCallback = onReadyCallback;
    this.initClient();
  }

  initClient() {
    logger.info('[WA-Adapter] Inicializando whatsapp-web.js en modo headless...');
    this.isReady = false;
    this.currentQrDataUri = null;
    this.qrGeneratedAt = null;

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './src/.wwebjs_auth' }),
      puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    this.client.on('qr', async (qr) => {
      this.isReady = false;
      this.qrGeneratedAt = Date.now();
      try {
        this.currentQrDataUri = await qrcodeLib.toDataURL(qr);
      } catch (err) {
        logger.error({ err: err.message }, '[WA-Adapter] Error generando QR Base64');
      }
      logger.info('[WA-Adapter] 🚨 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP 🚨');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.currentQrDataUri = null;
      this.qrGeneratedAt = null;
      logger.info('[WA-Adapter] ✨ ¡Cliente de WhatsApp Web está LISTO! ✨');
      if (this.onReadyCallback) {
        this.onReadyCallback().catch(e => logger.error({ err: e.message }, 'Error en callback onReady'));
      }
    });

    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      this.currentQrDataUri = null;
      this.qrGeneratedAt = null;
      logger.warn({ reason }, '[WA-Adapter] Cliente desconectado');
    });

    this.client.on('message_ack', async (msg, ack) => {
      if (!STATUS_CALLBACK) return;
      
      let MessageStatus = 'sent';
      if (ack === 2) MessageStatus = 'delivered';
      if (ack === 3) MessageStatus = 'read';

      try {
        await axios.post(STATUS_CALLBACK, {
          MessageSid: msg.id.id,
          MessageStatus: MessageStatus,
        }, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        logger.info({ sid: msg.id.id, status: MessageStatus }, '[WA-Adapter] ACK reportado al webhook');
      } catch (err) {
        logger.warn({ error: err.message }, '[WA-Adapter] Error reportando ACK al webhook local');
      }
    });

    this.client.initialize().catch(e => {
      logger.error({ error: e.message }, '[WA-Adapter] Error al inicializar whatsapp-web.js');
    });
  }

  async unlink() {
    if (this.client) {
      logger.info('[WA-Adapter] Desvinculando WhatsApp...');
      try {
        // En lugar de llamar a logout() (que causa crashes por frames detached en puppeteer),
        // destruimos el cliente para cerrar el navegador y luego borramos la sesión de disco.
        await this.client.destroy();
      } catch (e) {
        logger.warn({ error: e.message }, '[WA-Adapter] Error al cerrar navegador');
      }

      const fs = require('fs');
      const path = require('path');
      const authPath = path.resolve('./src/.wwebjs_auth');
      if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        logger.info('[WA-Adapter] Sesión borrada exitosamente.');
      }

      this.client = null;
      this.isReady = false;
      this.currentQrDataUri = null;
      this.qrGeneratedAt = null;
      
      // Iniciar de nuevo para tener un nuevo código QR
      setTimeout(() => this.initClient(), 2000);
    }
  }

  async enviar({ telefono, mensaje, idMensaje }) {
    if (!this.isReady || !this.client || !this.client.info) {
      logger.warn('[WA-Adapter] Cliente no listo. Encolando mensaje...');
      throw new WhatsAppNotLinkedError('WhatsApp Web no está vinculado o no está listo.');
    }

    const destino = fmtWhatsApp(telefono);

    try {
      const msg = await this.client.sendMessage(destino, mensaje);
      logger.info({ sid: msg.id.id, destino, idMensaje }, '[WA-Adapter] Mensaje enviado por whatsapp-web.js');
      return { exitoso: true, referencia: msg.id.id };
    } catch (e) {
      logger.error({ error: e.message, destino }, '[WA-Adapter] Error al enviar mensaje');
      throw e; // Permitir que el consumer haga retry
    }
  }
}

module.exports = { WhatsappWebJSAdapter, WhatsAppNotLinkedError };
