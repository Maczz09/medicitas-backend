const { randomUUID } = require('crypto');
const { RangoHorario } = require('../value-objects/RangoHorario');
const { SemanaISO } = require('../value-objects/SemanaISO');

// Agregado: una semana específica de un médico, completa y explícita — un
// día de esta semana sin entrada en `dias` está inactivo ese día, NO cae a
// la plantilla día por día (ver plan del módulo, sección "regla de semana
// parcial"). El frontend es responsable de precargar el formulario copiando
// la plantilla u otra semana para que el médico rara vez tenga que enfrentar
// un día realmente vacío sin querer.
class HorarioSemana {
  constructor({ idSemana, idMedico, semanaInicio, dias }) {
    this.idSemana = idSemana;
    this.idMedico = idMedico;
    this.semanaInicio = new SemanaISO(semanaInicio).toString();
    this.dias = (dias || []).map((d) => HorarioSemana._normalizarDia(d));
  }

  static _normalizarDia({ diaSemana, horaInicio, horaFin, duracionCitaMin, activo }) {
    if (activo === false) {
      return { diaSemana, activo: false, horaInicio: null, horaFin: null, duracionCitaMin: null };
    }
    const rango = new RangoHorario({ horaInicio, horaFin, duracionCitaMin });
    return { diaSemana, activo: true, ...rango };
  }

  static crear({ idMedico, semanaInicio, dias }) {
    return new HorarioSemana({ idSemana: `SEM-${randomUUID()}`, idMedico, semanaInicio, dias });
  }

  diaConfig(diaSemana) {
    return this.dias.find((d) => d.diaSemana === diaSemana && d.activo) || null;
  }
}

module.exports = { HorarioSemana };
