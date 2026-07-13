const logger = require('../../../shared/logger/logger');
const { Traza } = require('../domain/entities/Traza');
const { DomainError } = require('../../../shared/domain/errors');
const { ejecutarConContexto } = require('../../../shared/infrastructure/traceContext');

const MAX_REINTENTOS = parseInt(process.env.AUD_MAX_REINTENTOS || '3');

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

    // El handler corre DENTRO del contexto de traza del mensaje (header
    // traceparent, propagado desde el request HTTP original vía outbox) para
    // que sus spans queden en la misma cascada de Jaeger.
    await this.channel.consume(QUEUE, async (msg) => {
      if (!msg) return;
      await ejecutarConContexto(msg.properties.headers, async () => {

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

        // Colas clásicas no pueblan x-delivery-count — se rastrea el intento
        // con un header propio para no reencolar indefinidamente.
        const intentoActual = (msg.properties.headers?.['x-retry-count'] || 0) + 1;

        logger.error({ err, routingKey, intentoActual }, 'Error al registrar traza.');

        if (intentoActual >= MAX_REINTENTOS) {
          logger.error({ routingKey, intentoActual }, 'Traza enviada a DLQ tras máximos reintentos');
          this.channel.nack(msg, false, false); // → DLQ
        } else {
          this.channel.ack(msg);
          this.channel.publish('', QUEUE, msg.content, {
            persistent: true,
            headers: { ...msg.properties.headers, 'x-retry-count': intentoActual },
          });
        }
      }
      }); // fin ejecutarConContexto
    });

    logger.info('Auditoría consumer iniciado. Escuchando: q.auditoria (routing key: #)');
  }
}

module.exports = { AuditoriaConsumer };
