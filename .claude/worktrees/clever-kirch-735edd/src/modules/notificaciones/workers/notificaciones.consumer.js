const rabbitmq = require('../../../config/rabbitmq');
const NotificacionService = require('../infrastructure/notificacion.service');
const { esEventoYaProcesado, marcarEventoProcesado } = require('../../../shared/infrastructure/idempotency');
const db = require('../../../config/database');

const notificacionSvc = new NotificacionService();

async function startConsumers() {
  const channel = rabbitmq.getChannel();
  if (!channel) throw new Error('RabbitMQ channel not ready for consumers');

  const q = await channel.assertQueue('notificaciones.queue', { durable: true });

  await channel.bindQueue(q.queue, 'medicitas.events', 'event.CitaReservada');
  await channel.bindQueue(q.queue, 'medicitas.events', 'event.CitaCancelada');
  await channel.bindQueue(q.queue, 'medicitas.events', 'event.CitaCanceladaPorTolerancia');
  await channel.bindQueue(q.queue, 'medicitas.events', 'event.PagoConfirmado');
  await channel.bindQueue(q.queue, 'medicitas.events', 'event.RecetaEmitida');
  await channel.bindQueue(q.queue, 'medicitas.events', 'event.ComprobanteGenerado');

  channel.prefetch(5);

  console.log('[Consumers] Escuchando eventos para Notificaciones...');

  channel.consume(q.queue, async (msg) => {
    if (msg !== null) {
      const routingKey = msg.fields.routingKey;
      const eventoStr = msg.content.toString();
      const eventoPayload = JSON.parse(eventoStr);
      
      const messageId = msg.properties.messageId || `msg-${Date.now()}`;
      
      const yaProcesado = await esEventoYaProcesado('svc_not', messageId, 'NotificacionesConsumer');
      
      if (yaProcesado) {
        console.log(`[Consumers] Mensaje duplicado ignorado: ${messageId}`);
        channel.ack(msg);
        return;
      }

      try {
        if (routingKey === 'event.CitaReservada') {
          await notificacionSvc.enviarEmail('paciente@example.com', 'Tu cita ha sido reservada (Pendiente de Pago)', `Hola, tu cita ha sido reservada. Tienes 15 minutos para pagarla.`);
        }
        else if (routingKey === 'event.CitaCancelada' || routingKey === 'event.CitaCanceladaPorTolerancia') {
          await notificacionSvc.enviarSMS('999888777', `Tu cita fue cancelada. Motivo: ${eventoPayload.motivo || 'Tolerancia de pago excedida'}`);
          const { smsEnviadosCounter } = require('../../../config/metrics');
          smsEnviadosCounter.inc();
        }
        else if (routingKey === 'event.PagoConfirmado') {
          await notificacionSvc.enviarEmail('paciente@example.com', 'Pago Confirmado - Cita Confirmada', `El pago de tu cita ha sido confirmado con éxito. ¡Te esperamos!`);
        }
        else if (routingKey === 'event.RecetaEmitida') {
          await notificacionSvc.enviarEmail('paciente@example.com', 'Tu receta médica digital', `Se ha emitido tu receta para: ${eventoPayload.medicamento}. Por favor acércate a la farmacia.`);
        }
        else if (routingKey === 'event.ComprobanteGenerado') {
          await notificacionSvc.enviarEmail('paciente@example.com', 'Tu comprobante de pago', `Adjunto encuentras el comprobante ${eventoPayload.numero_serie} por S/ ${eventoPayload.monto_total}.`);
        }

        const conn = await db.getConnection();
        await marcarEventoProcesado(conn, 'svc_not', messageId, routingKey, 'NotificacionesConsumer');
        conn.release();

        channel.ack(msg);
      } catch (err) {
        console.error('[Consumers] Error procesando notificación:', err);
        channel.nack(msg, false, true);
      }
    }
  });
}

module.exports = { startConsumers };
