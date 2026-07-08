const { RangoHorarioInvalidoError } = require('../horarios.errors');

const HHMM = /^\d{2}:\d{2}$/;

// Recorta "HH:MM:SS" (lo que devuelve mysql2 para columnas TIME) a "HH:MM".
function aHHMM(valor) {
  return typeof valor === 'string' ? valor.slice(0, 5) : valor;
}

class RangoHorario {
  constructor({ horaInicio, horaFin, duracionCitaMin }) {
    const hIni = aHHMM(horaInicio);
    const hFin = aHHMM(horaFin);

    if (!hIni || !hFin) {
      throw new RangoHorarioInvalidoError('horaInicio y horaFin son obligatorias');
    }
    if (!HHMM.test(hIni) || !HHMM.test(hFin)) {
      throw new RangoHorarioInvalidoError('horaInicio/horaFin deben tener formato HH:MM');
    }

    const [h1, m1] = hIni.split(':').map(Number);
    const [h2, m2] = hFin.split(':').map(Number);
    const minutosInicio = h1 * 60 + m1;
    const minutosFin = h2 * 60 + m2;

    if (minutosFin <= minutosInicio) {
      throw new RangoHorarioInvalidoError(`horaFin (${hFin}) debe ser posterior a horaInicio (${hIni})`);
    }

    const duracion = Number(duracionCitaMin) || 30;
    if (duracion < 5 || duracion > 480) {
      throw new RangoHorarioInvalidoError('duracionCitaMin debe estar entre 5 y 480 minutos');
    }
    if (minutosFin - minutosInicio < duracion) {
      throw new RangoHorarioInvalidoError('El rango horario es más corto que la duración de una sola cita');
    }

    this.horaInicio = hIni;
    this.horaFin = hFin;
    this.duracionCitaMin = duracion;
  }
}

module.exports = { RangoHorario };
