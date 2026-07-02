const { v4: uuidv4 } = require('uuid');
const errores = require('../../domain/prescripciones.errors');
const { DomainError } = require('../../../../shared/domain/errors');

const ESTADOS_WEBHOOK_VALIDOS = ['RETIRADA', 'RECHAZADA', 'DESPACHADA'];

// Estados locales del Despacho que ya satisfacen la petición de un estado de
// webhook — se tratan como no-op idempotente en vez de reintentar la transición
// (evita sobrescribir un estado más específico, p. ej. RECHAZADA_POR_STOCK, con
// uno más genérico si el webhook llega repetido o fuera de orden).
const GRUPOS_IDEMPOTENTES = {
  RETIRADA:   ['RETIRADA'],
  DESPACHADA: ['DESPACHADA', 'RETIRADA'],
  RECHAZADA:  ['RECHAZADA', 'RECHAZADA_POR_STOCK', 'RECHAZADA_POR_VALIDACION'],
};

class ProcesarWebhookFarmaciaUseCase {
  constructor({ despachosRepository, eventPublisher, getConnection, logger }) {
    this.despachosRepo = despachosRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
    this.logger = logger;
  }

  async ejecutar(payload) {
    const { idReceta, estado, referenciaFarmacia, motivoRechazo, correlationId } = payload;
    const cid = correlationId || uuidv4();

    if (!ESTADOS_WEBHOOK_VALIDOS.includes(estado)) {
      throw new DomainError('ESTADO_WEBHOOK_INVALIDO', 400,
        `Estado de webhook no soportado: ${estado}. Valores válidos: ${ESTADOS_WEBHOOK_VALIDOS.join(', ')}.`);
    }

    this.logger.info({ idReceta, estado }, 'Procesando webhook de farmacia');

    const connTest = await this.getConnection();
    let despacho;
    try {
      despacho = await this.despachosRepo.findById(idReceta, connTest);
    } finally {
      connTest.release();
    }

    if (!despacho) {
      throw errores.RECETA_NO_ENCONTRADA(idReceta);
    }

    if (GRUPOS_IDEMPOTENTES[estado].includes(despacho.estado)) {
      this.logger.info(
        { idReceta, estado, estadoActual: despacho.estado },
        'El despacho ya está en un estado consistente con el webhook. Ignorando por idempotencia.'
      );
      return { mensaje: 'Webhook procesado (idempotente)', estado: despacho.estado };
    }

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      if (estado === 'RETIRADA') {
        despacho.marcarRetirada();
        await this.despachosRepo.actualizarEstado(despacho, conn);
        await this.eventPublisher.publish(conn, 'RecetaRetirada', {
          idReceta: despacho.id,
          idPaciente: despacho.idPaciente,
          fechaRetiro: despacho.fechaRetiro,
        }, cid);
      } else if (estado === 'RECHAZADA') {
        despacho.marcarRechazada(motivoRechazo || 'Rechazado por farmacia vía Webhook');
        await this.despachosRepo.actualizarEstado(despacho, conn);
        await this.eventPublisher.publish(conn, 'RecetaRechazada', {
          idReceta: despacho.id,
          idPaciente: despacho.idPaciente,
          motivoRechazo: despacho.motivoRechazo,
          tipo: 'WEBHOOK',
        }, cid);
      } else {
        // DESPACHADA
        despacho.marcarDespachada({ referenciaFarmacia });
        await this.despachosRepo.actualizarEstado(despacho, conn);
        await this.eventPublisher.publish(conn, 'RecetaDespachada', {
          idReceta: despacho.id,
          idPaciente: despacho.idPaciente,
          idEncuentroClinico: despacho.idEncuentroClinico,
          farmacia: despacho.idFarmacia,
          numero: despacho.id,
        }, cid);
      }

      await conn.commit();
      this.logger.info({ idReceta, estado }, 'Webhook de farmacia procesado con éxito');
    } catch (err) {
      await conn.rollback();

      // Transición inválida por condición de carrera (otro proceso ya avanzó el
      // estado del despacho entre la verificación de idempotencia y esta
      // transacción) — se trata como no-op en vez de propagar un error que un
      // emisor con reintentos automáticos repetiría indefinidamente.
      if (err instanceof DomainError && err.status === 409) {
        this.logger.warn(
          { idReceta, estado, motivo: err.message },
          'Transición inválida por carrera de estado — respondiendo idempotente.'
        );
        return { mensaje: 'Webhook procesado (idempotente, carrera de estado)', estado: despacho.estado };
      }

      this.logger.error({ err, idReceta }, 'Error procesando webhook de farmacia');
      throw err;
    } finally {
      conn.release();
    }

    return { mensaje: 'Webhook procesado con éxito', estado: despacho.estado };
  }
}

module.exports = ProcesarWebhookFarmaciaUseCase;
