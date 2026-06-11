const { DomainError } = require('../../../../shared/domain/errors');

const EstadoComprobante = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  EMITIDO:   'EMITIDO',
  ERROR:     'ERROR',
});

class Comprobante {
  constructor({
    id, idPago, idPaciente, idCita, tipo, numero,
    montoTotal, montoCubiertoSeguro, montoCopago,
    metodoPago, tieneCobertura, estado,
    rutaPdf, urlDescarga, nombrePaciente,
    errorMensaje, intentosGeneracion, correlationId,
  }) {
    this.id                   = id;
    this.idPago               = idPago;
    this.idPaciente           = idPaciente;
    this.idCita               = idCita;
    this.tipo                 = tipo;
    this.numero               = numero;
    this.montoTotal           = montoTotal;
    this.montoCubiertoSeguro  = montoCubiertoSeguro;
    this.montoCopago          = montoCopago;
    this.metodoPago           = metodoPago;
    this.tieneCobertura       = tieneCobertura;
    this.estado               = estado || EstadoComprobante.PENDIENTE;
    this.rutaPdf              = rutaPdf              || null;
    this.urlDescarga          = urlDescarga          || null;
    this.nombrePaciente       = nombrePaciente       || null;
    this.errorMensaje         = errorMensaje         || null;
    this.intentosGeneracion   = intentosGeneracion   || 0;
    this.correlationId        = correlationId        || null;
  }

  static crear({ idPago, idPaciente, idCita, tipo, numero,
                 montoTotal, montoCubiertoSeguro, montoCopago,
                 metodoPago, tieneCobertura, correlationId }) {
    return new Comprobante({
      id:     `FAC-${Date.now()}`,
      idPago, idPaciente, idCita, tipo, numero,
      montoTotal, montoCubiertoSeguro, montoCopago,
      metodoPago, tieneCobertura,
      estado: EstadoComprobante.PENDIENTE,
      correlationId,
    });
  }

  marcarEmitido(rutaPdf, urlDescarga, nombrePaciente) {
    if (this.estado !== EstadoComprobante.PENDIENTE) {
      throw new DomainError('TRANSICION_INVALIDA', 409,
        `Solo se puede emitir desde PENDIENTE. Estado actual: ${this.estado}`);
    }
    this.estado         = EstadoComprobante.EMITIDO;
    this.rutaPdf        = rutaPdf;
    this.urlDescarga    = urlDescarga;
    this.nombrePaciente = nombrePaciente || null;
    return this;
  }

  marcarError(mensaje) {
    this.estado               = EstadoComprobante.ERROR;
    this.errorMensaje         = mensaje;
    this.intentosGeneracion  += 1;
    return this;
  }

  estaEmitido()   { return this.estado === EstadoComprobante.EMITIDO; }
  estaPendiente() { return this.estado === EstadoComprobante.PENDIENTE; }
  estaEnError()   { return this.estado === EstadoComprobante.ERROR; }
  puedeReintentar(maxReintentos) {
    return this.intentosGeneracion < maxReintentos;
  }
}

module.exports = { Comprobante, EstadoComprobante };
