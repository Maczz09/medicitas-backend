const path = require('path');
const fs   = require('fs');
const { DomainError } = require('../../../../shared/domain/errors');

class FacturacionController {
  constructor(consultarUseCase) {
    this.consultarUseCase = consultarUseCase;
  }

  consultarPorId = async (req, res, next) => {
    try {
      const resp = await this.consultarUseCase.porId(req.params.id);
      res.json(resp);
    } catch (err) {
      next(err);
    }
  };

  consultarPorPago = async (req, res, next) => {
    try {
      const resp = await this.consultarUseCase.porPago(req.params.idPago);
      res.json(resp);
    } catch (err) {
      next(err);
    }
  };

  descargarPdf = async (req, res, next) => {
    try {
      const rutaPdf = await this.consultarUseCase.obtenerPdfPath(req.params.id);
      if (!fs.existsSync(rutaPdf)) {
        return next(new DomainError('ERROR_LECTURA_PDF', 500, 'El archivo PDF no existe físicamente'));
      }
      res.download(rutaPdf, path.basename(rutaPdf));
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { FacturacionController };
