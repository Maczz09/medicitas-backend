const { v4: uuidv4 } = require('uuid');

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
    this.logger.info({ idReceta, estado }, 'Procesando webhook de farmacia');

    const connTest = await this.getConnection();
    let despacho;
    try {
        despacho = await this.despachosRepo.findById(idReceta, connTest);
    } finally {
        connTest.release();
    }

    if (!despacho) {
      const err = require('../../domain/prescripciones.errors');
      throw err.RECETA_NO_ENCONTRADA(idReceta);
    }

    // Idempotencia: si ya tiene el estado deseado, ignorar
    if (despacho.estado === estado) {
      this.logger.info({ idReceta, estado }, 'El despacho ya tiene el estado indicado. Ignorando webhook por idempotencia.');
      return { mensaje: 'Webhook procesado (idempotente)' };
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
      } else if (estado === 'DESPACHADA') {
         despacho.marcarDespachada({ referenciaFarmacia });
         await this.despachosRepo.actualizarEstado(despacho, conn);
         await this.eventPublisher.publish(conn, 'RecetaDespachada', {
          idReceta: despacho.id,
          idPaciente: despacho.idPaciente,
          idEncuentroClinico: despacho.idEncuentroClinico,
          farmacia: despacho.idFarmacia,
          numero: despacho.id,
        }, cid);
      } else {
        throw new Error(`Estado de webhook no soportado: ${estado}`);
      }

      await conn.commit();
      this.logger.info({ idReceta, estado }, 'Webhook de farmacia procesado con éxito');
    } catch (err) {
      await conn.rollback();
      this.logger.error({ err, idReceta }, 'Error procesando webhook de farmacia');
      throw err;
    } finally {
      conn.release();
    }

    return { mensaje: 'Webhook procesado con éxito' };
  }
}

module.exports = ProcesarWebhookFarmaciaUseCase;
