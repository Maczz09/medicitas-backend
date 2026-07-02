const logger = require('../../../../shared/logger/logger');

class ProcesarWebhookAseguradoraUseCase {
  constructor({ coberturaRepository, eventPublisher, getConnection }) {
    this.coberturaRepo = coberturaRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar(payload, correlationId) {
    const { idValidacion, numeroPoliza, estadoAnterior, nuevoEstado, fechaActualizacion } = payload;

    logger.info(
      { idValidacion, numeroPoliza, nuevoEstado, correlationId },
      '[ProcesarWebhookAseguradoraUseCase] Procesando webhook de cambio de estado de póliza'
    );

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      // Si el webhook trae idValidacion, se actualiza esa fila puntual (más
      // seguro). Si no, se cae al fallback por numeroPoliza, que puede afectar
      // varias validaciones históricas de la misma póliza.
      const affectedRows = idValidacion
        ? await this.coberturaRepo.actualizarPorId(idValidacion, nuevoEstado, conn)
        : await this.coberturaRepo.actualizarPorPoliza(numeroPoliza, nuevoEstado, conn);

      logger.info(
        { idValidacion, numeroPoliza, actualizadas: affectedRows, correlationId },
        '[ProcesarWebhookAseguradoraUseCase] Validaciones locales actualizadas'
      );

      // Solo publicar el evento si realmente hubo un cambio — evita eventos
      // duplicados/ruido aguas abajo (notificaciones, auditoría) cuando el
      // webhook es un reenvío o no encontró filas que actualizar.
      if (affectedRows > 0) {
        await this.eventPublisher.publish(conn, 'CoberturaActualizadaPorWebhook', {
          idValidacion: idValidacion || null,
          numeroPoliza,
          estadoAnterior,
          nuevoEstado,
          fechaActualizacion,
          registrosAfectados: affectedRows,
        }, correlationId);
      }

      await conn.commit();

      return { mensaje: 'Webhook procesado correctamente', registrosAfectados: affectedRows };
    } catch (err) {
      await conn.rollback();
      logger.error(
        { err, idValidacion, numeroPoliza, correlationId },
        '[ProcesarWebhookAseguradoraUseCase] Error procesando webhook de aseguradora'
      );
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { ProcesarWebhookAseguradoraUseCase };
