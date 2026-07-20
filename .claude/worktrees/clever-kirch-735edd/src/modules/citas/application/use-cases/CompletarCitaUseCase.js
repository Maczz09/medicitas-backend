const { CitaNoEncontradaError } = require('../../domain/cita.errors');

class CompletarCitaUseCase {
  constructor({ citasRepository, getConnection }) {
    this.citasRepo = citasRepository;
    this.getConnection = getConnection;
  }

  async ejecutar({ idCita }) {
    const cita = await this.citasRepo.findById(idCita);
    if (!cita) {
      throw new CitaNoEncontradaError(`Cita ${idCita} no encontrada`);
    }

    cita.completar(); // Validates transition

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      await this.citasRepo.update(cita, conn);
      // No event is published for Completion by CIT, it's driven by HCL
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
    };
  }
}

module.exports = { CompletarCitaUseCase };
