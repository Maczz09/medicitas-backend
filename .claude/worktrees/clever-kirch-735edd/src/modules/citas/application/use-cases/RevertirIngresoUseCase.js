const { CitaNoEncontradaError } = require('../../domain/cita.errors');

class RevertirIngresoUseCase {
  constructor({ citasRepository, eventPublisher, getConnection }) {
    this.citasRepo      = citasRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection  = getConnection;
  }

  async ejecutar({ idCita }, correlationId) {
    const cita = await this.citasRepo.findById(idCita);
    if (!cita) throw new CitaNoEncontradaError(`Cita ${idCita} no encontrada`);

    cita.revertirIngreso();

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.citasRepo.update(cita, conn);
      await this.eventPublisher.publish(conn, 'IngresoRevertido', {
        idCita: cita.id,
        idPaciente: cita.idPaciente,
        idMedico: cita.idMedico,
        fechaHoraCita: cita.fechaHora.toISOString(),
      }, correlationId);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return {
      idCita: cita.id,
      estado: cita.estado,
      mensaje: 'Ingreso revertido. La cita volvió a Pendiente.',
      correlationId,
    };
  }
}

module.exports = { RevertirIngresoUseCase };
