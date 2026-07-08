const { MedicoNoEncontradoError } = require('../../domain/horarios.errors');

// Migrado de medicos.usecases.js#getDisponibilidadBase. Devuelve solo
// horarios (plantilla) + bloqueos — el médico en sí lo compone
// MedicosController combinando esto con su propio medicosUseCases.getMedico(),
// para que este módulo no necesite saber nada del perfil del médico, solo
// validar que existe.
class ConsultarDisponibilidadUseCase {
  constructor({ medicoValidatorPort, horariosRepository }) {
    this.medicoValidator = medicoValidatorPort;
    this.horariosRepo = horariosRepository;
  }

  async ejecutar(idMedico) {
    const existe = await this.medicoValidator.existeMedicoActivo(idMedico);
    if (!existe) throw new MedicoNoEncontradoError();

    const plantilla = await this.horariosRepo.findPlantillaCompleta(idMedico);
    const bloqueos = await this.horariosRepo.findBloqueosFuturos(idMedico);

    return {
      horarios: plantilla.map((p) => ({
        dia_semana: p.diaSemana,
        hora_inicio: p.horaInicio,
        hora_fin: p.horaFin,
        duracion_cita_min: p.duracionCitaMin,
        activo: p.activo,
      })),
      bloqueos: bloqueos.map((b) => ({
        id_bloqueo: b.idBloqueo,
        fecha_inicio: b.fechaInicio,
        fecha_fin: b.fechaFin,
        motivo: b.motivo,
      })),
    };
  }
}

module.exports = { ConsultarDisponibilidadUseCase };
