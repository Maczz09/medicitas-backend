const { DomainError } = require('../../../../shared/domain/errors');

class PagosController {
  constructor({ confirmarUseCase, reversarUseCase,
                consultarUseCase, consultarPorCitaUseCase }) {
    this.confirmarUseCase       = confirmarUseCase;
    this.reversarUseCase        = reversarUseCase;
    this.consultarUseCase       = consultarUseCase;
    this.consultarPorCitaUseCase = consultarPorCitaUseCase;

    this.confirmar         = this.confirmar.bind(this);
    this.reversar          = this.reversar.bind(this);
    this.consultar         = this.consultar.bind(this);
    this.consultarPorCita  = this.consultarPorCita.bind(this);
  }

  async confirmar(req, res, next) {
    try {
      const {
        idCita, idPaciente, metodoPago, montoTotal, montoCubiertoSeguro,
        montoCopago, tipoComprobante, idValidacionCobertura,
        codigoAutorizacionSeguro, observaciones,
      } = req.body;

      if (!idCita || !idPaciente || !metodoPago ||
          montoTotal === undefined || montoCopago === undefined) {
        throw new DomainError('DATOS_INVALIDOS', 400,
          'idCita, idPaciente, metodoPago, montoTotal y montoCopago son obligatorios');
      }

      const resultado = await this.confirmarUseCase.ejecutar(
        {
          idCita, idPaciente, metodoPago,
          montoTotal:               parseFloat(montoTotal),
          montoCubiertoSeguro:      parseFloat(montoCubiertoSeguro || 0),
          montoCopago:              parseFloat(montoCopago),
          tipoComprobante:          tipoComprobante          || 'BOLETA',
          idValidacionCobertura:    idValidacionCobertura    || null,
          codigoAutorizacionSeguro: codigoAutorizacionSeguro || null,
          observaciones:            observaciones            || null,
        },
        req.correlationId
      );

      return res.status(201).json(resultado);
    } catch (err) { next(err); }
  }

  async reversar(req, res, next) {
    try {
      const { motivo } = req.body;
      if (!motivo || motivo.trim().length === 0) {
        throw new DomainError('DATOS_INVALIDOS', 400, 'El motivo de reversión es obligatorio');
      }
      const resultado = await this.reversarUseCase.ejecutar(
        { idPago: req.params.id, motivo },
        req.correlationId
      );
      return res.status(200).json(resultado);
    } catch (err) { next(err); }
  }

  async consultar(req, res, next) {
    try {
      const resultado = await this.consultarUseCase.ejecutar(req.params.id);
      if (!resultado) {
        throw new DomainError('PAGO_NO_ENCONTRADO', 404,
          `El pago ${req.params.id} no existe`);
      }
      return res.status(200).json({ ...resultado, correlationId: req.correlationId });
    } catch (err) { next(err); }
  }

  async consultarPorCita(req, res, next) {
    try {
      const resultado = await this.consultarPorCitaUseCase.ejecutar(req.params.idCita);
      if (!resultado) {
        return res.status(404).json({
          codigo:        'PAGO_NO_REGISTRADO',
          mensaje:       `La cita ${req.params.idCita} aún no tiene pago registrado`,
          correlationId: req.correlationId,
        });
      }
      return res.status(200).json({ ...resultado, correlationId: req.correlationId });
    } catch (err) { next(err); }
  }
}

module.exports = { PagosController };
