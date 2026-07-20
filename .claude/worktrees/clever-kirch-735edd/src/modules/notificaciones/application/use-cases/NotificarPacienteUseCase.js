const { DomainError }  = require('../../../../shared/domain/errors');
const { MensajeSMS }   = require('../../domain/entities/MensajeSMS');
const { renderizar }   = require('../../domain/templates/SMSTemplates');
const logger = require('../../../../shared/logger/logger');

class NotificarPacienteUseCase {
  constructor({ mensajesSMSRepository, smsGateway, pacienteTelefono, eventPublisher, getConnection }) {
    this.smsRepo          = mensajesSMSRepository;
    this.smsGateway       = smsGateway;
    this.pacienteTelefono = pacienteTelefono;
    this.eventPublisher   = eventPublisher;
    this.getConnection    = getConnection;
  }

  async ejecutar(payload, tipoEvento, idEvento, correlationId) {
    const idPaciente = payload.idPaciente;

    // ── 1. Idempotencia — verificar si ya fue procesado ───────────────────────
    const existente = await this.smsRepo.findByIdEvento(idEvento);
    if (existente) {
      logger.info({ idEvento, tipoEvento, estado: existente.estado },
        'SMS ya procesado para este evento. Omitiendo (idempotencia).');
      return; // Consumer hará ACK
    }

    // ── 2. Renderizar el mensaje usando la plantilla ──────────────────────────
    // Si renderizar retorna null, el evento no tiene plantilla — el consumer ya
    // filtró esto, pero lo validamos de nuevo como defensa.
    const mensajeTexto = renderizar(tipoEvento, payload);
    if (!mensajeTexto) {
      logger.warn({ tipoEvento }, 'No hay plantilla SMS para este tipo de evento. Ignorando.');
      return;
    }

    // ── 3. Obtener teléfono del paciente ─────────────────────────────────────
    // Si el evento ya trae el teléfono en el payload lo usamos directamente
    // (evita HTTP al mismo servicio que puede chocar con el rate-limiter).
    let telefono = payload.pacienteTelefono || null;
    if (!telefono) {
      telefono = await this.pacienteTelefono.obtenerTelefono(idPaciente);
    }
    if (!telefono) {
      throw new DomainError('PACIENTE_SIN_TELEFONO', 422,
        `El paciente ${idPaciente} no tiene teléfono registrado. No se puede enviar WhatsApp.`);
    }

    const idMensaje = require('crypto').randomUUID();

    // ── 4. Llamar al SMS Gateway (Mock o Real + Circuit Breaker) ──────────────
    let mensajeSMS;
    let eventoPublicar;
    let payloadEvento;

    try {
      const resultado = await this.smsGateway.enviar({
        telefono,
        mensaje: mensajeTexto,
        idMensaje,
      });

      // ── 5a. Éxito: construir entidad ENVIADO ────────────────────────────────
      mensajeSMS = MensajeSMS.crearEnviado({
        idEvento, tipoEvento, idPaciente, telefono,
        mensaje: mensajeTexto,
        referenciaGateway: resultado.referencia,
        correlationId,
      });
      eventoPublicar = 'SMSEnviado';
      payloadEvento  = {
        idMensaje:        mensajeSMS.id,
        idEventoOrigen:   idEvento,
        tipoEvento,
        idPaciente,
        telefono,
        referenciaGateway: resultado.referencia,
      };

      logger.info({ tipoEvento, idPaciente, referencia: resultado.referencia },
        'SMS enviado correctamente');

    } catch (err) {
      if (err.name === 'WhatsAppNotLinkedError') {
        // ── 5b. WhatsApp no vinculado: PENDIENTE_VINCULACION ─────────────────────
        mensajeSMS = MensajeSMS.crearPendienteVinculacion({
          idEvento, tipoEvento, idPaciente, telefono,
          mensaje:      mensajeTexto,
          correlationId,
        });
        eventoPublicar = 'SMSPendienteVinculacion';
        payloadEvento  = {
          idMensaje:      mensajeSMS.id,
          idEventoOrigen: idEvento,
          tipoEvento,
          idPaciente,
        };
        logger.warn({ tipoEvento, idPaciente }, 'WhatsApp no vinculado. Mensaje encolado.');
      } else {
        // ── 5c. Fallo real en gateway: construir entidad FALLIDO ─────────────────
        mensajeSMS = MensajeSMS.crearFallido({
          idEvento, tipoEvento, idPaciente, telefono,
          mensaje:      mensajeTexto,
          errorDetalle: err.message,
          correlationId,
        });
        eventoPublicar = 'SMSFallido';
        payloadEvento  = {
          idMensaje:      mensajeSMS.id,
          idEventoOrigen: idEvento,
          tipoEvento,
          idPaciente,
          errorDetalle:   err.message,
        };
        logger.warn({ tipoEvento, idPaciente, error: err.message }, 'SMS fallido');
      }
    }

    // ── 6. TX: INSERT mensajes_sms + INSERT outbox ────────────────────────────
    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      await this.smsRepo.save(mensajeSMS, conn);

      await this.eventPublisher.publish(conn, eventoPublicar, payloadEvento, correlationId);

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      // Si la TX falla pero el SMS ya fue enviado (estado ENVIADO),
      // el consumer hará NACK. En el próximo intento, la idempotencia
      // no ayuda porque el registro no se guardó — el SMS se enviará de nuevo.
      // Esto es un trade-off aceptable para un MVP (mejor doble SMS que ninguno).
      logger.error({ txErr, idEvento, estado: mensajeSMS.estado },
        'Error al persistir resultado de SMS. El consumer reintentará.');
      throw txErr;
    } finally {
      conn.release();
    }

    // Si el SMS fue FALLIDO, relanzar para que el consumer haga NACK y reintente
    if (mensajeSMS.estaFallido()) {
      throw new Error(`SMS fallido para evento ${tipoEvento}: ${mensajeSMS.errorDetalle}`);
    }
  }
}

module.exports = { NotificarPacienteUseCase };
