class WebhookController {
  constructor({ procesarWebhookUseCase }) {
    this.procesarWebhookUseCase = procesarWebhookUseCase;
    this.recibirWebhook = this.recibirWebhook.bind(this);
  }

  async recibirWebhook(req, res, next) {
    try {
      // El middleware de apiKey o validación de tokens debe estar en la ruta
      const payload = req.body || {};
      const correlationId = req.correlationId;

      // nuevoEstado es obligatorio (se usa como bind param en ambas rutas de
      // actualización); idValidacion o numeroPoliza deben venir al menos uno,
      // porque sin idValidacion el caso de uso cae al fallback por numeroPoliza.
      const { idValidacion, numeroPoliza, nuevoEstado } = payload;
      if (!nuevoEstado || (!idValidacion && !numeroPoliza)) {
        return res.status(400).json({
          codigo: 'DATOS_INCOMPLETOS',
          mensaje: 'nuevoEstado es obligatorio, junto con idValidacion o numeroPoliza.',
          correlationId: correlationId || null,
          timestamp: new Date().toISOString(),
        });
      }

      await this.procesarWebhookUseCase.ejecutar(payload, correlationId);

      return res.status(200).json({ mensaje: 'Webhook procesado correctamente' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = { WebhookController };
