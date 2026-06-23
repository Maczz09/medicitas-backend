const logger = require('../../../shared/logger/logger');
const { EVENTOS_NOTIFICABLES } = require('../domain/templates/SMSTemplates');

const MAX_REINTENTOS = parseInt(process.env.NOT_MAX_REINTENTOS || '3');

class NotificacionesConsumer {
  constructor(channel, notificarUseCase) {
    this.channel          = channel;
    this.notificarUseCase = notificarUseCase;
  }

  async iniciar() {
    const QUEUE = 'q.notificaciones';
    await this.channel.prefetch(5);

    await this.channel.consume(QUEUE, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      let evento = null;

      try {
        evento = JSON.parse(msg.content.toString());
        const tipoEvento = evento.evento;

        // Ignorar eventos que llegan a la queue pero no generan SMS
        // Ejemplo: IngresoRegistrado, IntentoReserva
        if (!EVENTOS_NOTIFICABLES.includes(tipoEvento)) {
          logger.debug({ tipoEvento, routingKey }, 'Evento recibido sin plantilla SMS. Descartando con ACK.');
          this.channel.ack(msg);
          return;
        }

        await this.notificarUseCase.ejecutar(
          evento.payload,
          tipoEvento,
          evento.idEvento,
          evento.correlationId
        );

        this.channel.ack(msg);

      } catch (err) {
        const deliveryCount = msg.properties.headers?.['x-delivery-count'] || 0;

        logger.error(
          { err: err.message, tipoEvento: evento?.evento, routingKey, deliveryCount },
          'Error en consumer de Notificaciones'
        );

        if (deliveryCount >= MAX_REINTENTOS) {
          logger.error({ routingKey, deliveryCount }, 'SMS enviado a DLQ después de máximos reintentos');
          this.channel.nack(msg, false, false); // → DLQ
        } else {
          this.channel.nack(msg, false, true); // requeue
        }
      }
    });

    logger.info('Notificaciones consumer iniciado. Escuchando: q.notificaciones');
  }
}

module.exports = { NotificacionesConsumer };
