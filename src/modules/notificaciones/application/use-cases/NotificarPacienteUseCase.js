const { DomainError }  = require('../../../../shared/domain/errors');
const { MensajeSMS }   = require('../../domain/entities/MensajeSMS');
const { renderizar }   = require('../../domain/templates/SMSTemplates');
const logger = require('../../../../shared/logger/logger');

// Deriva un nombre de archivo legible a partir de la URL de descarga sin
// depender de la forma del payload del evento (funciona igual para
// comprobantes de facturación y recetas de prescripciones): las rutas de
// descarga terminan en `/:id/pdf`, así que el penúltimo segmento es el id.
function _nombreArchivoDesdeUrl(url, fallback = 'documento.pdf') {
  try {
    const partes = new URL(url).pathname.split('/').filter(Boolean);
    const id = partes.length >= 2 ? partes[partes.length - 2] : null;
    return id ? `${id}.pdf` : fallback;
  } catch {
    return fallback;
  }
}

class NotificarPacienteUseCase {
  constructor({ mensajesSMSRepository, smsGateway, pacienteTelefono, eventPublisher, getConnection, documentoDownloader }) {
    this.smsRepo             = mensajesSMSRepository;
    this.smsGateway          = smsGateway;
    this.pacienteTelefono    = pacienteTelefono;
    this.eventPublisher      = eventPublisher;
    this.getConnection       = getConnection;
    this.documentoDownloader = documentoDownloader;
  }

  // Si el evento trae `urlDescarga` (ComprobanteEmitido, RecetaPDFDisponible,
  // RecetaContingenciaGenerada), intenta descargar el PDF a memoria y
  // adjuntarlo por WhatsApp en vez de solo mandar el link. Si la descarga
  // falla, el gateway no soporta adjuntos, o whatsapp-web.js rechaza el
  // Base64, cae al texto plano con el link — el camino ya probado — para
  // no perder la notificación ni colgar el worker de RabbitMQ.
  async _enviarConDocumentoOFallback({ telefono, mensajeTexto, urlDescarga, idMensaje }) {
    try {
      const buffer        = await this.documentoDownloader.descargarBuffer(urlDescarga);
      const base64Data    = buffer.toString('base64');
      const nombreArchivo = _nombreArchivoDesdeUrl(urlDescarga);

      return await this.smsGateway.enviarPDFBase64({ telefono, base64Data, nombreArchivo, mensajeTexto, idMensaje });
    } catch (err) {
      if (err.name === 'WhatsAppNotLinkedError') throw err; // mismo estado sin importar el camino

      logger.warn({ error: err.message, urlDescarga },
        '[Notificaciones] No se pudo adjuntar el PDF (descarga o envío falló). Enviando solo el texto con el link.');
      return this.smsGateway.enviar({ telefono, mensaje: mensajeTexto, idMensaje });
    }
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
      const resultado = payload.urlDescarga
        ? await this._enviarConDocumentoOFallback({ telefono, mensajeTexto, urlDescarga: payload.urlDescarga, idMensaje })
        : await this.smsGateway.enviar({ telefono, mensaje: mensajeTexto, idMensaje });

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
