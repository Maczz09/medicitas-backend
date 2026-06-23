class AuditoriaController {
  constructor({ consultarTrazasUseCase, reconstruirCorrelacionUseCase }) {
    this.consultarTrazasUseCase        = consultarTrazasUseCase;
    this.reconstruirCorrelacionUseCase = reconstruirCorrelacionUseCase;

    this.consultarTrazas      = this.consultarTrazas.bind(this);
    this.consultarCorrelacion = this.consultarCorrelacion.bind(this);
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
