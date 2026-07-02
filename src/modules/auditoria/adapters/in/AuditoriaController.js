const axios = require('axios');
const { WhatsappWebJSAdapter } = require('../../../notificaciones/adapters/out/gateway/WhatsappWebJSAdapter');

class AuditoriaController {
  constructor({ consultarTrazasUseCase, reconstruirCorrelacionUseCase }) {
    this.consultarTrazasUseCase        = consultarTrazasUseCase;
    this.reconstruirCorrelacionUseCase = reconstruirCorrelacionUseCase;

    this.consultarTrazas      = this.consultarTrazas.bind(this);
    this.consultarCorrelacion = this.consultarCorrelacion.bind(this);
    this.getHealth            = this.getHealth.bind(this);
    this.postUnlinkWhatsapp   = this.postUnlinkWhatsapp.bind(this);
  }

  async getHealth(req, res, next) {
    try {
      const response = {
        medicitas: { status: 'UP' },
        aseguradora: { status: 'DOWN' },
        farmacia: { status: 'DOWN' },
        whatsapp: { isConnected: false, currentQrDataUri: null }
      };

      // 1. WhatsApp
      if (WhatsappWebJSAdapter.instance) {
        response.whatsapp = {
          isConnected: WhatsappWebJSAdapter.instance.isReady,
          currentQrDataUri: WhatsappWebJSAdapter.instance.currentQrDataUri,
          qrGeneratedAt: WhatsappWebJSAdapter.instance.qrGeneratedAt
        };
      }

      // 2. Aseguradora
      try {
        const url = process.env.ASEGURADORA_API_URL?.replace('/api/v1', '/health') || 'http://localhost:4001/health';
        await axios.get(url, { timeout: 2000 });
        response.aseguradora.status = 'UP';
      } catch (e) {
        // Ignorar error, se queda DOWN
      }

      // 3. Farmacia
      try {
        // FARMACIA_API_URL suele ser .../api/v1/farmacia/recepcionar-receta
        const url = process.env.FARMACIA_API_URL?.split('/api/v1')[0] + '/health' || 'http://farmacia_api:4002/health';
        await axios.get(url, { timeout: 2000 });
        response.farmacia.status = 'UP';
      } catch (e) {
        // Ignorar error, se queda DOWN
      }

      return res.status(200).json(response);
    } catch (err) { next(err); }
  }

  async postUnlinkWhatsapp(req, res, next) {
    try {
      if (WhatsappWebJSAdapter.instance) {
        await WhatsappWebJSAdapter.instance.unlink();
        return res.status(200).json({ message: 'WhatsApp desvinculado. Generando nuevo QR en breve...' });
      } else {
        return res.status(400).json({ error: 'El adaptador de WhatsApp no está inicializado.' });
      }
    } catch (err) { next(err); }
  }

  async consultarTrazas(req, res, next) {
    try {
      const resultado = await this.consultarTrazasUseCase.ejecutar({
        servicio:      req.query.servicio,
        tipoEvento:    req.query.tipoEvento,
        desde:         req.query.desde,
        hasta:         req.query.hasta,
        correlationId: req.query.correlationId,
        pagina:        req.query.pagina,
        porPagina:     req.query.porPagina,
      });
      return res.status(200).json({ ...resultado, correlationId: req.correlationId });
    } catch (err) { next(err); }
  }

  async consultarCorrelacion(req, res, next) {
    try {
      const resultado = await this.reconstruirCorrelacionUseCase.ejecutar(req.params.correlationId);
      return res.status(200).json(resultado);
    } catch (err) { next(err); }
  }
}

module.exports = { AuditoriaController };
