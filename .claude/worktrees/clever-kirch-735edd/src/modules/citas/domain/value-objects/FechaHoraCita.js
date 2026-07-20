const { FechaHoraInvalidaError } = require('../cita.errors');
const { ValidationError } = require('../../../../shared/domain/errors');

// Helpers que usan la hora LOCAL del proceso (respetan TZ=America/Lima)
function _localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _localTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

class FechaHoraCita {
  constructor(fechaHoraISO) {
    if (!fechaHoraISO) {
      throw new ValidationError('fechaHora es obligatoria', 'DATOS_INVALIDOS');
    }
    const fecha = new Date(fechaHoraISO);
    if (isNaN(fecha.getTime())) {
      throw new FechaHoraInvalidaError(`Formato de fecha inválido: ${fechaHoraISO}`);
    }
    // Permitir hasta 30 min en el pasado (para poder agendar en el slot actual)
    const TOLERANCIA_MS = 30 * 60 * 1000;
    if (fecha < new Date(Date.now() - TOLERANCIA_MS)) {
      throw new FechaHoraInvalidaError('La fecha y hora de la cita ya pasó');
    }
    this.valor = fecha;
  }

  toDate()       { return this.valor; }
  toISOString()  { return this.valor.toISOString(); }
  toDateString() { return _localDate(this.valor); }  // YYYY-MM-DD local
  toTimeString() { return _localTime(this.valor); }  // HH:MM local
}

module.exports = { FechaHoraCita };
