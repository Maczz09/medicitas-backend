const { CitaNoEncontradaError } = require('../../domain/cita.errors');

class CancelarCitaUseCase {
  constructor({ citasRepository, disponibilidadCache, eventPublisher, getConnection }) {
    this.citasRepo = citasRepository;
    this.disponibilidadCache = disponibilidadCache;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar({ idCita, motivo }, correlationId) {
    const cita = await this.citasRepo.findById(idCita);
    if (!cita) {
      throw new CitaNoEncontradaError(`Cita ${idCita} no encontrada`);
    }

    cita.cancelar(); // Throws TransicionEstadoInvalidaError if invalid

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      await this.citasRepo.update(cita, conn);

      await this.eventPublisher.publish(conn, 'CitaCancelada', {
        idCita: cita.id,
        idPaciente: cita.idPaciente,
        idMedico: cita.idMedico,
        motivo: motivo || null,
      }, correlationId);

      await conn.commit();

      await this.disponibilidadCache.liberarSlot(cita.idMedico, cita.fechaHora).catch(() => {});

    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return {
      idCita: cita.id,
      estado: cita.estado,
      mensaje: 'Cita cancelada. Notificación SMS encolada.',
      correlationId,
    };
  }
}

module.exports = { CancelarCitaUseCase };
