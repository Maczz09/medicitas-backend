const { randomUUID } = require('crypto');
const { RangoBloqueoInvalidoError } = require('../horarios.errors');

class Bloqueo {
  constructor({ idBloqueo, idMedico, fechaInicio, fechaFin, motivo }) {
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new RangoBloqueoInvalidoError('fechaInicio/fechaFin inválidas');
    }
    if (fin <= inicio) {
      throw new RangoBloqueoInvalidoError('fechaFin debe ser posterior a fechaInicio');
    }

    this.idBloqueo = idBloqueo;
    this.idMedico = idMedico;
    this.fechaInicio = inicio;
    this.fechaFin = fin;
    this.motivo = motivo || null;
  }

  static crear({ idMedico, fechaInicio, fechaFin, motivo }) {
    return new Bloqueo({ idBloqueo: `BLQ-${randomUUID()}`, idMedico, fechaInicio, fechaFin, motivo });
  }

  seSolapaCon(inicio, fin) {
    return this.fechaInicio < fin && this.fechaFin > inicio;
  }
}

module.exports = { Bloqueo };
