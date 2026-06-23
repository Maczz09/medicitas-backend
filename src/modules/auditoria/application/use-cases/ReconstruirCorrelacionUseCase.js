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

    if (trazas.length === 0) {
      throw new DomainError('CORRELACION_NO_ENCONTRADA', 404,
        `No se encontraron trazas para correlationId ${correlationId}`);
    }

    return {
      correlationId,
      totalEventos: trazas.length,
      linea_tiempo: trazas.map(t => ({
        servicioOrigen: t.servicioOrigen,
        tipoEvento:     t.tipoEvento,
        recibidoEn:     t.recibidoEn,
        payload:        t.payload,
      })),
    };
  }
}

module.exports = { ReconstruirCorrelacionUseCase };
