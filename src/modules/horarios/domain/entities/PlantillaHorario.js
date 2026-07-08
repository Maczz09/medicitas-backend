const { randomUUID } = require('crypto');
const { RangoHorario } = require('../value-objects/RangoHorario');

// Un día de la plantilla recurrente de un médico — el respaldo que se usa
// para sembrar una semana nueva y para cubrir cualquier semana futura que
// nadie configuró explícitamente todavía.
class PlantillaHorario {
  constructor({ idPlantilla, idMedico, diaSemana, horaInicio, horaFin, duracionCitaMin, activo }) {
    this.idPlantilla = idPlantilla;
    this.idMedico = idMedico;
    this.diaSemana = diaSemana;
    this.activo = activo !== false;

    if (this.activo) {
      const rango = new RangoHorario({ horaInicio, horaFin, duracionCitaMin });
      this.horaInicio = rango.horaInicio;
      this.horaFin = rango.horaFin;
      this.duracionCitaMin = rango.duracionCitaMin;
    } else {
      this.horaInicio = null;
      this.horaFin = null;
      this.duracionCitaMin = null;
    }
  }

  static crear({ idMedico, diaSemana, horaInicio, horaFin, duracionCitaMin }) {
    return new PlantillaHorario({
      idPlantilla: `PLT-${randomUUID()}`,
      idMedico,
      diaSemana,
      horaInicio,
      horaFin,
      duracionCitaMin,
      activo: true,
    });
  }
}

module.exports = { PlantillaHorario };
