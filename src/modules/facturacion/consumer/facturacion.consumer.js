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
        const deliveryCount = msg.properties.headers?.['x-delivery-count'] || 0;
        logger.error(
          { err, idPago: evento?.payload?.idPago, deliveryCount },
          'Error al procesar PagoAprobado en Facturación'
        );

        if (deliveryCount >= MAX_REINTENTOS) {
          logger.error(
            { idPago: evento?.payload?.idPago },
            `Comprobante enviado a DLQ después de ${MAX_REINTENTOS} intentos`
          );
          this.channel.nack(msg, false, false); 
        } else {
          this.channel.nack(msg, false, true); 
        }
      }
    });

    logger.info('Facturación consumer iniciado. Escuchando: q.facturacion');
  }
}

module.exports = { FacturacionConsumer };
