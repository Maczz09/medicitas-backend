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
        logger.error({ err: err.message, idEvento: evento?.idEvento },
          'Error en consumer de Prescripciones. Reencolando con pausa...');

        setTimeout(() => {
          this.channel.nack(msg, false, true); // requeue
        }, 5000);
      }
    });

    logger.info({ queue: QUEUE }, 'prescriptions_service: consumer iniciado');
  }
}

module.exports = { PrescripcionesConsumer };
