const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarHistoricoProfundoUseCase {
  constructor({ expedienteRepository, encuentroRepository, eventPublisher, getConnection }) {
    this.expedienteRepository = expedienteRepository;
    this.encuentroRepository  = encuentroRepository;
    this.eventPublisher       = eventPublisher;
    this.getConnection        = getConnection;
  }

  async ejecutar({ idPaciente, pagina, porPagina, idUsuario, rolUsuario }, correlationId) {
    const p  = parseInt(pagina, 10);
    const pp = parseInt(porPagina, 10);
    if (isNaN(p) || isNaN(pp) || p < 1 || pp < 1 || pp > 50) {
      throw new DomainError('PAGINACION_INVALIDA', 'pagina >= 1 y porPagina entre 1 y 50', 400);
    }

    const expediente = await this.expedienteRepository.findByIdPaciente(idPaciente);
    if (!expediente) {
      throw new DomainError('EXPEDIENTE_NO_ENCONTRADO', `Sin expediente para paciente ${idPaciente}`, 404);
    }

    const resultado = await this.encuentroRepository.findPaginadoByExpediente(
      expediente.id, { pagina: p, porPagina: pp }
    );

    const conn = await this.getConnection();
    try {
      await conn.beginTransaction();
      await this.eventPublisher.publish(conn, 'AccesoExpediente', {
        idExpediente: expediente.id,
        idPaciente,
        idUsuario,
        rolUsuario,
        accion: 'CONSULTA_HISTORICO_PROFUNDO',
        timestamp: new Date().toISOString(),
      }, correlationId);
      await conn.commit();
    } catch {
      await conn.rollback();
    } finally {
      conn.release();
    }

    return { ...resultado, correlationId };
  }
}

module.exports = { ConsultarHistoricoProfundoUseCase };
