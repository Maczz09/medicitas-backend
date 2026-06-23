const { DomainError } = require('../../../../shared/domain/errors');

const EstadoSMS = Object.freeze({
  ENVIADO: 'ENVIADO',
  FALLIDO: 'FALLIDO',
});

class MensajeSMS {
  constructor({
    id, idEvento, tipoEvento, idPaciente, telefono,
    mensaje, estado, referenciaGateway, errorDetalle,
    intentos, correlationId, sentAt, createdAt
  }) {
    this.id                 = id;
    this.idEvento           = idEvento;
    this.tipoEvento         = tipoEvento;
    this.idPaciente         = idPaciente;
    this.telefono           = telefono;
    this.mensaje            = mensaje;
    this.estado             = estado;
    this.referenciaGateway  = referenciaGateway || null;
    this.errorDetalle       = errorDetalle       || null;
    this.intentos           = intentos           || 1;
    this.correlationId      = correlationId      || null;
    this.sentAt             = sentAt             || null;
    this.createdAt          = createdAt          || new Date();
  }

  static crearEnviado({ idEvento, tipoEvento, idPaciente, telefono, mensaje, referenciaGateway, correlationId }) {
    return new MensajeSMS({
      id:                require('crypto').randomUUID(),
      idEvento, tipoEvento, idPaciente, telefono, mensaje,
      estado:            EstadoSMS.ENVIADO,
      referenciaGateway,
      correlationId,
      sentAt:            new Date(),
    });
  }

  static crearFallido({ idEvento, tipoEvento, idPaciente, telefono, mensaje, errorDetalle, correlationId }) {
    return new MensajeSMS({
      id:           require('crypto').randomUUID(),
      idEvento, tipoEvento, idPaciente, telefono, mensaje,
      estado:       EstadoSMS.FALLIDO,
      errorDetalle,
      correlationId,
    });
  }

  estaEnviado() { return this.estado === EstadoSMS.ENVIADO; }
  estaFallido() { return this.estado === EstadoSMS.FALLIDO; }
}

module.exports = { MensajeSMS, EstadoSMS };
