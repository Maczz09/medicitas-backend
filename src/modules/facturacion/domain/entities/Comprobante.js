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
    rutaPdf, urlDescarga, nombrePaciente, nombreVerificado,
    errorMensaje, intentosGeneracion, correlationId,
    fechaEmision,
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
    // Default true a propósito (no `|| true`, que convertiría un false real
    // en true): cubre el camino feliz y el 404 limpio (paciente no existe).
    // Solo es false cuando marcarEmitido() lo recibe explícito porque
    // Pacientes estaba inalcanzable — ver GenerarComprobanteUseCase.js.
    this.nombreVerificado     = nombreVerificado     !== false;
    this.errorMensaje         = errorMensaje         || null;
    this.intentosGeneracion   = intentosGeneracion   || 0;
    this.correlationId        = correlationId        || null;
    // created_at de la BD — el PDF regenerado en la descarga imprime esta
    // fecha (no la del día de la descarga).
    this.fechaEmision         = fechaEmision          || null;
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

  marcarEmitido(rutaPdf, urlDescarga, nombrePaciente, nombreVerificado = true) {
    if (this.estado !== EstadoComprobante.PENDIENTE) {
      throw new DomainError('TRANSICION_INVALIDA', 409,
        `Solo se puede emitir desde PENDIENTE. Estado actual: ${this.estado}`);
    }
    this.estado           = EstadoComprobante.EMITIDO;
    this.rutaPdf          = rutaPdf;
    this.urlDescarga      = urlDescarga;
    this.nombrePaciente   = nombrePaciente || null;
    this.nombreVerificado = nombreVerificado !== false;
    return this;
  }

  // Se llama SOLO desde el recovery-replay (server.js) cuando Facturación→
  // Pacientes estaba inalcanzable durante la emisión. Encapsula la mutación
  // en el dominio (no se toca comprobante.nombreVerificado directamente).
  marcarNombreVerificado(nombrePaciente) {
    this.nombrePaciente   = nombrePaciente || null;
    this.nombreVerificado = true;
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
