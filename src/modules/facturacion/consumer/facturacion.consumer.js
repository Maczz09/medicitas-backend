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
        // (solo en quorum queues) — nack(requeue=true) por sí solo reencola sin
        // límite real. Se rastrea el intento con un header propio.
        const intentoActual = (msg.properties.headers?.['x-retry-count'] || 0) + 1;

        logger.error(
          { err: err.message, idPago: evento?.payload?.idPago, intentoActual },
          'Error al procesar PagoAprobado en Facturación.'
        );

        if (intentoActual >= MAX_REINTENTOS) {
          logger.error({ idPago: evento?.payload?.idPago, intentoActual }, 'PagoAprobado enviado a DLQ tras máximos reintentos');
          this.channel.nack(msg, false, false); // → DLQ
        } else {
          // Backoff antes de republicar — evita saturar CPU con reintentos inmediatos.
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

    logger.info('Facturación consumer iniciado. Escuchando: q.facturacion');
  }
}

module.exports = { FacturacionConsumer };
