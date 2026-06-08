const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarResumenClinicoUseCase {
  constructor({ expedienteRepository, eventPublisher, getConnection }) {
    this.expedienteRepository = expedienteRepository;
    this.eventPublisher       = eventPublisher;
    this.getConnection        = getConnection;
  }

  async ejecutar({ idPaciente, idUsuario, rolUsuario }, correlationId) {
    const resumen = await this.expedienteRepository.findResumenByIdPaciente(idPaciente);
    if (!resumen) {
      throw new DomainError('EXPEDIENTE_NO_ENCONTRADO', `Sin expediente para paciente ${idPaciente}`, 404);
    }

    const conn = await this.getConnection();
    try {
      await conn.beginTransaction();
      await this.eventPublisher.publish(conn, 'AccesoExpediente', {
        idExpediente: resumen.idExpediente,
        idPaciente,
        idUsuario,
        rolUsuario,
        accion: 'CONSULTA_RESUMEN',
        timestamp: new Date().toISOString(),
      }, correlationId);
      await conn.commit();
    } catch {
      await conn.rollback();
    } finally {
      conn.release();
    }

    return { ...resumen, correlationId };
  }
}

module.exports = { ConsultarResumenClinicoUseCase };
