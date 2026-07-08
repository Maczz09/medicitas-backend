const { SemanaISO } = require('../../domain/value-objects/SemanaISO');
const { MedicoNoEncontradoError } = require('../../domain/horarios.errors');

// Vista completa de UNA semana para el editor del frontend: si el médico ya
// definió un override explícito para esa semana, se devuelve tal cual
// (origen SEMANA); si no, se arma la misma vista a partir de la plantilla
// (origen PLANTILLA) para que el frontend pueda precargar el formulario con
// algo editable en vez de mostrar los 7 días vacíos.
class ConsultarHorarioSemanaUseCase {
  constructor({ medicoValidatorPort, horariosRepository }) {
    this.medicoValidator = medicoValidatorPort;
    this.horariosRepo = horariosRepository;
  }

  async ejecutar(idMedico, semanaInicioInput) {
    const existe = await this.medicoValidator.existeMedicoActivo(idMedico);
    if (!existe) throw new MedicoNoEncontradoError();

    const semanaInicio = new SemanaISO(semanaInicioInput).toString();

    const semana = await this.horariosRepo.findSemana(idMedico, semanaInicio);
    if (semana) {
      return {
        semanaInicio,
        origen: 'SEMANA',
        dias: semana.dias.map((d) => ({
          dia_semana: d.diaSemana,
          hora_inicio: d.horaInicio,
          hora_fin: d.horaFin,
          duracion_cita_min: d.duracionCitaMin,
          activo: d.activo,
        })),
      };
    }

    const plantilla = await this.horariosRepo.findPlantillaCompleta(idMedico);
    return {
      semanaInicio,
      origen: 'PLANTILLA',
      dias: plantilla.map((p) => ({
        dia_semana: p.diaSemana,
        hora_inicio: p.horaInicio,
        hora_fin: p.horaFin,
        duracion_cita_min: p.duracionCitaMin,
        activo: p.activo,
      })),
    };
  }
}

module.exports = { ConsultarHorarioSemanaUseCase };
