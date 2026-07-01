const logger = require('../../../../shared/logger/logger');

class ProcesarWebhookAseguradoraUseCase {
  constructor({ coberturaRepository, eventPublisher, getConnection }) {
    this.coberturaRepo = coberturaRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar(payload, correlationId) {
    const { numeroPoliza, estadoAnterior, nuevoEstado, fechaActualizacion } = payload;

    logger.info(
      { numeroPoliza, nuevoEstado, correlationId },
      '[ProcesarWebhookAseguradoraUseCase] Procesando webhook de cambio de estado de póliza'
    );

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      // 1. Buscar todas las coberturas_consultas recientes de esta póliza que estén vigentes o pendientes
      // En una arquitectura real, tendríamos un repositorio específico o query.
      // Vamos a ejecutar un UPDATE masivo en coberturas_consultas para marcar el nuevo estado.
      // Nota: coberturas_consultas guarda un historial. 
      // Si la póliza se suspendió, marcamos las vigentes asociadas a esa póliza como el nuevoEstado.
      
      const [result] = await conn.execute(
        `UPDATE svc_seg.validaciones_cobertura 
         SET estado_cobertura = ?
         WHERE numero_poliza = ? 
           AND estado_cobertura != ?`,
        [nuevoEstado, numeroPoliza, nuevoEstado]
      );

      logger.info(
        { numeroPoliza, actualizadas: result.affectedRows, correlationId },
        '[ProcesarWebhookAseguradoraUseCase] Validaciones locales actualizadas'
      );

      // 2. Emitir evento asíncrono para que otros módulos (como Citas) puedan reaccionar
      await this.eventPublisher.publish(conn, 'CoberturaActualizadaPorWebhook', {
        numeroPoliza,
        estadoAnterior,
        nuevoEstado,
        fechaActualizacion,
        registrosAfectados: result.affectedRows
      }, correlationId);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      logger.error(
        { err, numeroPoliza, correlationId },
        '[ProcesarWebhookAseguradoraUseCase] Error procesando webhook de aseguradora'
      );
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { ProcesarWebhookAseguradoraUseCase };
