class CitasController {
  constructor({
    reservarCitaUseCase,
    cancelarCitaUseCase,
    reprogramarCitaUseCase,
    registrarIngresoUseCase,
    revertirIngresoUseCase,
    completarCitaUseCase,
    consultarCitaUseCase
  }) {
    this.reservarCitaUC     = reservarCitaUseCase;
    this.cancelarCitaUC     = cancelarCitaUseCase;
    this.reprogramarCitaUC  = reprogramarCitaUseCase;
    this.registrarIngresoUC = registrarIngresoUseCase;
    this.revertirIngresoUC  = revertirIngresoUseCase;
    this.completarCitaUC    = completarCitaUseCase;
    this.consultarCitaUC    = consultarCitaUseCase;
  }

  reservarCita = async (req, res, next) => {
    try {
      const result = await this.reservarCitaUC.ejecutar(req.body, req.correlationId);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  consultarCita = async (req, res, next) => {
    try {
      const result = await this.consultarCitaUC.ejecutar(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  cancelarCita = async (req, res, next) => {
    try {
      const result = await this.cancelarCitaUC.ejecutar(
        { idCita: req.params.id, motivo: req.body.motivo }, 
        req.correlationId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  reprogramarCita = async (req, res, next) => {
    try {
      const result = await this.reprogramarCitaUC.ejecutar(
        { 
          idCita: req.params.id, 
          nuevaFechaHora: req.body.nuevaFechaHora,
          idMedico: req.body.idMedico 
        }, 
        req.correlationId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  registrarIngreso = async (req, res, next) => {
    try {
      const result = await this.registrarIngresoUC.ejecutar(
        { idCita: req.params.id }, 
        req.correlationId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  revertirIngreso = async (req, res, next) => {
    try {
      const result = await this.revertirIngresoUC.ejecutar(
        { idCita: req.params.id },
        req.correlationId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  completarCita = async (req, res, next) => {
    try {
      const result = await this.completarCitaUC.ejecutar(
        { idCita: req.params.id }
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { CitasController };
