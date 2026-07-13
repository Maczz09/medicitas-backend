class FacturacionController {
  constructor(consultarUseCase, pdfGenerator) {
    this.consultarUseCase = consultarUseCase;
    this.pdfGenerator = pdfGenerator;
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
      const comp = await this.consultarUseCase.obtenerParaPdf(req.params.id);
      const buffer = await this.pdfGenerator.generarBuffer(comp);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${comp.numero}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { FacturacionController };
