const { DomainError } = require('../../../../shared/domain/errors');

class SegurosController {
  constructor({ validarCoberturaUseCase, consultarValidacionUseCase }) {
    this.validarCoberturaUseCase = validarCoberturaUseCase;
    this.consultarValidacionUseCase = consultarValidacionUseCase;

    this.validarCobertura = this.validarCobertura.bind(this);
    this.consultarValidacion = this.consultarValidacion.bind(this);
  }

  async validarCobertura(req, res, next) {
    try {
      const dto = req.body;
      const correlationId = req.correlationId;

      const resultado = await this.validarCoberturaUseCase.ejecutar(dto, correlationId);
      
      // La validación exitosa (incluso si es RECHAZADA o PENDIENTE) devuelve 200 OK
      res.status(200).json(resultado);
    } catch (error) {
      next(error);
    }
  }

  async consultarValidacion(req, res, next) {
    try {
      const { id } = req.params;
      const resultado = await this.consultarValidacionUseCase.ejecutar(id);
      
      res.status(200).json(resultado);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = { SegurosController };
