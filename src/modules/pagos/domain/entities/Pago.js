const { DomainError } = require('../../../../shared/domain/errors');

const EstadoPago = Object.freeze({
  APROBADO:  'APROBADO',
  REVERSADO: 'REVERSADO',
});

class Pago {
  constructor({
    id, idCita, idPaciente,
    idValidacionCobertura, codigoAutorizacionSeguro,
    metodoPago, montoTotal, montoCubiertoSeguro, montoCopago,
    tipoComprobante, estado, observaciones, correlationId,
  }) {
    this.id                        = id;
    this.idCita                    = idCita;
    this.idPaciente                = idPaciente;
    this.idValidacionCobertura     = idValidacionCobertura     || null;
    this.codigoAutorizacionSeguro  = codigoAutorizacionSeguro  || null;
    this.metodoPago                = metodoPago;
    this.montoTotal                = montoTotal;
    this.montoCubiertoSeguro       = montoCubiertoSeguro;
    this.montoCopago               = montoCopago;
    this.tipoComprobante           = tipoComprobante;
    this.estado                    = estado || EstadoPago.APROBADO;
    this.observaciones             = observaciones || null;
    this.correlationId             = correlationId || null;
  }

  static crear({
    idCita, idPaciente, idValidacionCobertura, codigoAutorizacionSeguro,
    metodoPago, montos, tipoComprobante, observaciones, correlationId,
  }) {
    return new Pago({
      id: `PAG-${Date.now()}`,
      idCita, idPaciente,
      idValidacionCobertura, codigoAutorizacionSeguro,
      metodoPago:           metodoPago.toString(),
      montoTotal:           montos.montoTotal,
      montoCubiertoSeguro:  montos.montoCubiertoSeguro,
      montoCopago:          montos.montoCopago,
      tipoComprobante:      tipoComprobante.toString(),
      estado:               EstadoPago.APROBADO,
      observaciones,
      correlationId,
    });
  }

  reversar(motivo) {
    if (this.estado !== EstadoPago.APROBADO) {
      throw new DomainError(
        'TRANSICION_ESTADO_INVALIDA', 409,
        `Solo se puede reversar un pago en estado 'APROBADO'. Estado actual: ${this.estado}`
      );
    }
    if (!motivo || motivo.trim().length === 0) {
      throw new DomainError('DATOS_INVALIDOS', 400, 'El motivo de reversión es obligatorio');
    }
    this.estado      = EstadoPago.REVERSADO;
    this.observaciones = motivo.trim();
    return this;
  }

  tieneCobertura() { return !!this.codigoAutorizacionSeguro; }
  estaAprobado()   { return this.estado === EstadoPago.APROBADO; }
  estaReversado()  { return this.estado === EstadoPago.REVERSADO; }
}

module.exports = { Pago, EstadoPago };
