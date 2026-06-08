const { FechaHoraInvalidaError } = require('../cita.errors');
const { ValidationError } = require('../../../../shared/domain/errors');

class FechaHoraCita {
  constructor(fechaHoraISO) {
    if (!fechaHoraISO) {
      throw new ValidationError('fechaHora es obligatoria', 'DATOS_INVALIDOS');
    }
    const fecha = new Date(fechaHoraISO);
    if (isNaN(fecha.getTime())) {
      throw new FechaHoraInvalidaError(`Formato de fecha inválido: ${fechaHoraISO}`);
    }
    if (fecha <= new Date()) {
      throw new FechaHoraInvalidaError('La fecha y hora de la cita debe ser en el futuro');
    }
    this.valor = fecha;
  }

  toDate() { return this.valor; }
  toISOString() { return this.valor.toISOString(); }
  toDateString() { return this.valor.toISOString().split('T')[0]; } // YYYY-MM-DD
  toTimeString() { return this.valor.toISOString().split('T')[1].slice(0, 5); } // HH:MM
}

module.exports = { FechaHoraCita };
