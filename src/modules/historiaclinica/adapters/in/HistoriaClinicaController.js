const { DomainError } = require('../../../../shared/domain/errors');

class HistoriaClinicaController {
  constructor({ resumenUseCase, historicoUseCase, registrarUseCase }) {
    this.resumenUseCase    = resumenUseCase;
    this.historicoUseCase  = historicoUseCase;
    this.registrarUseCase  = registrarUseCase;

    this.obtenerResumen        = this.obtenerResumen.bind(this);
    this.obtenerHistorico      = this.obtenerHistorico.bind(this);
    this.registrarEncuentro    = this.registrarEncuentro.bind(this);
  }

  async obtenerResumen(req, res, next) {
    try {
      const resultado = await this.resumenUseCase.ejecutar(
        {
          idPaciente: req.params.idPaciente,
          idUsuario:  req.user.sub,
          rolUsuario: req.user.rolNombre,
        },
        req.correlationId
      );
      return res.status(200).json(resultado);
    } catch (err) {
      next(err);
    }
  }

  async obtenerHistorico(req, res, next) {
    try {
      const resultado = await this.historicoUseCase.ejecutar(
        {
          idPaciente: req.params.idPaciente,
          pagina:     req.query.pagina    || 1,
          porPagina:  req.query.porPagina || 10,
          idUsuario:  req.user.sub,
          rolUsuario: req.user.rolNombre,
        },
        req.correlationId
      );
      return res.status(200).json(resultado);
    } catch (err) {
      next(err);
    }
  }

  async registrarEncuentro(req, res, next) {
    try {
      const { idCita, diagnosticoCie10, descripcion, prescripciones } = req.body;

      if (!idCita || !diagnosticoCie10) {
        throw new DomainError('DATOS_INVALIDOS', 'idCita y diagnosticoCie10 son obligatorios', 400);
      }

      const resultado = await this.registrarUseCase.ejecutar(
        {
          idPaciente:      req.params.idPaciente,
          idCita,
          diagnosticoCie10,
          descripcion:     descripcion || null,
          prescripciones:  prescripciones || [],
          idMedico:        req.user.idMedico || req.user.sub,
          rolUsuario:      req.user.rolNombre,
          idUsuario:       req.user.sub,
        },
        req.correlationId
      );
      return res.status(201).json(resultado);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = { HistoriaClinicaController };
