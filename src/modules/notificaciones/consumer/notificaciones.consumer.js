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
        // RabbitMQ NO puebla `x-delivery-count` en colas clásicas (solo en
        // quorum queues) — nack(requeue=true) reencola el mensaje indefinidamente
        // sin incrementar ningún contador visible, así que el umbral de DLQ nunca
        // se alcanzaba y un solo mensaje fallido quedaba reintentando por siempre.
        // Se rastrea el intento con un header propio que viajaba con el mensaje.
        const intentoActual = (msg.properties.headers?.['x-retry-count'] || 0) + 1;

        logger.error(
          { err: err.message, tipoEvento: evento?.evento, routingKey, intentoActual },
          'Error en consumer de Notificaciones'
        );

        if (intentoActual >= MAX_REINTENTOS) {
          logger.error({ routingKey, intentoActual }, 'SMS enviado a DLQ después de máximos reintentos');
          this.channel.nack(msg, false, false); // → DLQ (vía dead-letter-exchange de la cola)
        } else {
          // No se puede reescribir el header de un mensaje reencolado vía nack;
          // se ACKea el original y se republica una copia con el contador actualizado.
          this.channel.ack(msg);
          this.channel.publish('', QUEUE, msg.content, {
            persistent: true,
            headers: { ...msg.properties.headers, 'x-retry-count': intentoActual },
          });
        }
      }
    });

    logger.info('Notificaciones consumer iniciado. Escuchando: q.notificaciones');
  }
}

module.exports = { NotificacionesConsumer };
