const logger = require('../../../shared/logger/logger');

const QUEUE = 'q.prescripciones';
const MAX_REINTENTOS = parseInt(process.env.PRE_MAX_REINTENTOS || '3');

class PrescripcionesConsumer {
  constructor(channel, iniciarDespachoUseCase) {
    this.channel = channel;
    this.iniciarDespachoUseCase = iniciarDespachoUseCase;
  }

  async iniciar() {
    await this.channel.prefetch(5);

    await this.channel.consume(QUEUE, async (msg) => {
      if (!msg) return;

      let evento;
      try {
        evento = JSON.parse(msg.content.toString());

        if (evento.evento !== 'PrescripcionEmitida') {
          logger.warn({ evento: evento.evento }, 'Evento no esperado en q.prescripciones — ACK sin procesar');
          this.channel.ack(msg);
          return;
        }

        await this.iniciarDespachoUseCase.ejecutar(evento.payload, evento.correlationId, evento.idEvento);
        this.channel.ack(msg);

      } catch (err) {
        // Colas clásicas no pueblan x-delivery-count — se rastrea el intento
        // con un header propio para no reencolar indefinidamente.
        const intentoActual = (msg.properties.headers?.['x-retry-count'] || 0) + 1;

        logger.error({ err: err.message, idEvento: evento?.idEvento, intentoActual },
          'Error en consumer de Prescripciones.');

        if (intentoActual >= MAX_REINTENTOS) {
          logger.error({ idEvento: evento?.idEvento, intentoActual }, 'Evento enviado a DLQ tras máximos reintentos');
          this.channel.nack(msg, false, false); // → DLQ
        } else {
          setTimeout(() => {
            this.channel.ack(msg);
            this.channel.publish('', QUEUE, msg.content, {
              persistent: true,
              headers: { ...msg.properties.headers, 'x-retry-count': intentoActual },
            });
          }, 5000);
        }
      }
    });

    logger.info({ queue: QUEUE }, 'prescriptions_service: consumer iniciado');
  }
}

module.exports = { PrescripcionesConsumer };
