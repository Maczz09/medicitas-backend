const logger = require('../../../../shared/logger/logger');
const { EstadoSMS } = require('../../domain/entities/MensajeSMS');

class ProcesarMensajesPendientesUseCase {
  constructor({ mensajesSMSRepository, getConnection, getGateway }) {
    this.smsRepo       = mensajesSMSRepository;
    this.getConnection = getConnection;
    this.getGateway    = getGateway;
  }

  async ejecutar() {
    try {
      // 1. Obtener todos los mensajes pendientes de vinculación
      const pendientes = await this.smsRepo.findByEstado(EstadoSMS.PENDIENTE_VINCULACION);
      
      if (pendientes.length === 0) {
        logger.info('[ProcesarPendientes] No hay mensajes pendientes en caché.');
        return;
      }

      logger.info({ total: pendientes.length }, '[ProcesarPendientes] Iniciando envío de mensajes encolados...');

      const gateway = this.getGateway();

      for (const msg of pendientes) {
        try {
          // Intentar enviar
          const resultado = await gateway.enviar({
            telefono: msg.telefono,
            mensaje: msg.mensaje,
            idMensaje: msg.id
          });

          // Actualizar estado a ENVIADO
          msg.marcarComoEnviado(resultado.referencia);
          await this.smsRepo.update(msg);

          logger.info({ idMensaje: msg.id, destino: msg.telefono }, '[ProcesarPendientes] Mensaje pendiente enviado correctamente.');
        } catch (err) {
          if (err.name === 'WhatsAppNotLinkedError') {
            // Se desvinculó de nuevo mientras enviábamos, frenar el loop
            logger.warn('[ProcesarPendientes] WhatsApp se desvinculó durante el procesamiento masivo. Abortando.');
            break;
          } else {
            // Fallo real (ej. número inválido), marcar como FALLIDO
            msg.marcarComoFallido(err.message);
            await this.smsRepo.update(msg);
            logger.warn({ idMensaje: msg.id, error: err.message }, '[ProcesarPendientes] Mensaje pendiente falló.');
          }
        }
      }
    } catch (e) {
      logger.error({ error: e.message }, '[ProcesarPendientes] Error inesperado procesando pendientes');
    }
  }
}

module.exports = { ProcesarMensajesPendientesUseCase };
