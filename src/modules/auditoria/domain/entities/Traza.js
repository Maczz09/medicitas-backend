const { DomainError } = require('../../../../shared/domain/errors');

class Traza {
  constructor({
    id, idEvento, servicioOrigen, tipoEvento,
    routingKey, payload, correlationId, timestampOrigen,
  }) {
    this.id              = id;
    this.idEvento        = idEvento;
    this.servicioOrigen  = servicioOrigen;
    this.tipoEvento      = tipoEvento;
    this.routingKey      = routingKey;
    this.payload         = payload; // objeto JS, se serializa en el repositorio
    this.correlationId   = correlationId || null;
    this.timestampOrigen = timestampOrigen || null;
  }

  /**
   * Construye una Traza a partir del mensaje crudo de RabbitMQ.
   * Valida solo la estructura mínima — NUNCA el contenido del payload.
   */
  static desdeMensaje(mensaje, routingKey) {
    const { idEvento, evento, origen, payload, correlationId, timestamp } = mensaje;

    // Validación estructural mínima — esto SÍ es responsabilidad de Auditoría
    if (!idEvento || !evento || !origen || payload === undefined) {
      throw new DomainError(
        'EVENTO_MALFORMADO', 400,
        `Evento recibido sin estructura mínima requerida (idEvento, evento, origen, payload). Routing key: ${routingKey}`
      );
    }

    return new Traza({
      id:              require('crypto').randomUUID(),
      idEvento,
      servicioOrigen:  origen,
      tipoEvento:      evento,
      routingKey,
      payload,
      correlationId:   correlationId || null,
      timestampOrigen: timestamp || null,
    });
  }
}

module.exports = { Traza };
