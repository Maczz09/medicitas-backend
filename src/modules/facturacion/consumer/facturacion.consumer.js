const logger = require('../../../shared/logger/logger');

const MAX_REINTENTOS = parseInt(process.env.FAC_MAX_REINTENTOS || '3');

class FacturacionConsumer {
  /**
   * @param {import('amqplib').Channel} channel
   * @param {import('../application/use-cases/GenerarComprobanteUseCase').GenerarComprobanteUseCase} generarUseCase
   */
  constructor(channel, generarUseCase) {
    this.channel       = channel;
    this.generarUseCase = generarUseCase;
  }

  async iniciar() {
    const QUEUE = 'q.facturacion';

    await this.channel.prefetch(1);

    await this.channel.consume(QUEUE, async (msg) => {
      if (!msg) return;

      const correlationId = msg.properties.correlationId || null;
      let evento = null;

      try {
        evento = JSON.parse(msg.content.toString());

        if (evento.evento !== 'PagoAprobado') {
          logger.warn({ evento: evento.evento }, 'Evento inesperado en q.facturacion. Ignorando.');
          this.channel.ack(msg);
          return;
        }

        logger.info(
          { idPago: evento.payload.idPago, correlationId: evento.correlationId },
          'Facturación: procesando PagoAprobado'
        );

        await this.generarUseCase.ejecutar(evento.payload, evento.correlationId || correlationId);

        this.channel.ack(msg);

      } catch (err) {
        // En colas clásicas de RabbitMQ, x-delivery-count no existe nativamente
        // a menos que se use quorum queues. Para simplificar y evitar bucles infinitos a la velocidad
        // de la luz, introducimos una pausa (backoff) que no bloquee totalmente el thread pero limite la frecuencia.
        logger.error(
          { err: err.message, idPago: evento?.payload?.idPago },
          'Error al procesar PagoAprobado en Facturación. Reencolando con pausa...'
        );

        // Simulamos un retraso antes de rechazar el mensaje para evitar saturar el CPU
        setTimeout(() => {
          this.channel.nack(msg, false, true); // requeue
        }, 5000); // 5 segundos de backoff
      }
    });

    logger.info('Facturación consumer iniciado. Escuchando: q.facturacion');
  }
}

module.exports = { FacturacionConsumer };
