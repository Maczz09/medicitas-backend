const logger = require('../../../shared/logger/logger');
const { Traza } = require('../domain/entities/Traza');
const { DomainError } = require('../../../shared/domain/errors');

class AuditoriaConsumer {
  /**
   * @param {import('amqplib').Channel} channel
   * @param {import('../application/use-cases/RegistrarEventoUseCase').RegistrarEventoUseCase} registrarUseCase
   */
  constructor(channel, registrarUseCase) {
    this.channel         = channel;
    this.registrarUseCase = registrarUseCase;
  }

  async iniciar() {
    const QUEUE = 'q.auditoria';

    await this.channel.prefetch(10);

    await this.channel.consume(QUEUE, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      let mensaje = null;

      try {
        mensaje = JSON.parse(msg.content.toString());

        const traza = Traza.desdeMensaje(mensaje, routingKey);

        await this.registrarUseCase.ejecutar(traza);

        this.channel.ack(msg);

      } catch (err) {
        if (err instanceof DomainError && err.httpStatus === 400) { // err.codigo === 'EVENTO_MALFORMADO'
          logger.warn(
            { routingKey, contenido: msg.content.toString().slice(0, 500), err: err.message },
            'Evento malformado recibido en Auditoría. Descartando (sin requeue).'
          );
          this.channel.nack(msg, false, false); // → DLQ para revisión manual
          return;
        }

        logger.error({ err, routingKey }, 'Error al registrar traza. Reintentando.');
        this.channel.nack(msg, false, true); // requeue
      }
    });

    logger.info('Auditoría consumer iniciado. Escuchando: q.auditoria (routing key: #)');
  }
}

module.exports = { AuditoriaConsumer };
