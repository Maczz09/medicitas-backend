const { v4: uuidv4 } = require('uuid');

class PrescripcionesController {
  constructor({ consultarEstadoRecetaUseCase, reintentarEnvioUseCase, marcarRetiradaUseCase }) {
    this.consultarEstadoRecetaUseCase = consultarEstadoRecetaUseCase;
    this.reintentarEnvioUseCase = reintentarEnvioUseCase;
    this.marcarRetiradaUseCase = marcarRetiradaUseCase;
  }

  async getReceta(req, res, next) {
    try {
      const { id } = req.params;
      const receta = await this.consultarEstadoRecetaUseCase.ejecutar(id);
      res.json(receta);
    } catch (err) {
      next(err);
    }
  }

  async reintentarEnvio(req, res, next) {
    try {
      const { id } = req.params;
      const correlationId = uuidv4();
      const resultado = await this.reintentarEnvioUseCase.ejecutar(id, correlationId);
      res.json({ ...resultado, correlationId });
    } catch (err) {
      next(err);
    }
  }

  async marcarRetirada(req, res, next) {
    try {
      const { id } = req.params;
      const correlationId = uuidv4();
      const resultado = await this.marcarRetiradaUseCase.ejecutar(id, correlationId);
      res.json({ ...resultado, correlationId });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = PrescripcionesController;
