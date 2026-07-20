const { DomainError } = require('../../../../shared/domain/errors');

class ReconstruirCorrelacionUseCase {
  constructor({ trazasRepository }) {
    this.trazasRepo = trazasRepository;
  }

  async ejecutar(correlationId) {
    if (!correlationId || correlationId.trim().length === 0) {
      throw new DomainError('FILTROS_INVALIDOS', 400, 'correlationId es obligatorio');
    }

    const trazas = await this.trazasRepo.buscarPorCorrelationId(correlationId);

    // Devuelve array vacío si no hay coincidencias (el frontend lo gestiona correctamente)
    return trazas.map(t => ({
      id:              t.id,
      idEvento:        t.idEvento,
      servicioOrigen:  t.servicioOrigen,
      tipoEvento:      t.tipoEvento,
      routingKey:      t.routingKey,
      payload:         t.payload,
      correlationId:   t.correlationId,
      timestampOrigen: t.timestampOrigen,
      recibidoEn:      t.recibidoEn,
    }));
  }
}

module.exports = { ReconstruirCorrelacionUseCase };
