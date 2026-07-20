class WebhookController {
  constructor({ procesarWebhookUseCase }) {
    this.procesarWebhookUseCase = procesarWebhookUseCase;
    this.recibirWebhook = this.recibirWebhook.bind(this);
  }

  async recibirWebhook(req, res, next) {
    try {
      // El middleware de apiKey o validación de tokens debe estar en la ruta
      const payload = req.body;
      const correlationId = req.correlationId;

      await this.procesarWebhookUseCase.ejecutar(payload, correlationId);

      return res.status(200).json({ mensaje: 'Webhook procesado correctamente' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = { WebhookController };
