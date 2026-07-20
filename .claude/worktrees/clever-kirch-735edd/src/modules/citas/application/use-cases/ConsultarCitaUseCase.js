const { CitaNoEncontradaError } = require('../../domain/cita.errors');

class ConsultarCitaUseCase {
  constructor({ citasRepository }) {
    this.citasRepo = citasRepository;
  }

  async ejecutar(idCita) {
    const cita = await this.citasRepo.findById(idCita);
    if (!cita) {
      throw new CitaNoEncontradaError(`Cita ${idCita} no encontrada`);
    }
    
    return {
      idCita: cita.id,
      idPaciente: cita.idPaciente,
      idMedico: cita.idMedico,
      fechaHora: cita.fechaHora.toISOString(),
      especialidad: cita.especialidad,
      estado: cita.estado,
      correlationId: cita.correlationId
    };
  }
}

module.exports = { ConsultarCitaUseCase };
