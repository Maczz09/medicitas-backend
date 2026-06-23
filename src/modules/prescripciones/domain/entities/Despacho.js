const { DomainError } = require('../../../../shared/domain/errors');

const ESTADOS = Object.freeze({
  CREADA:                   'CREADA',
  ENVIADA_A_FARMACIA:       'ENVIADA_A_FARMACIA',
  DESPACHADA:               'DESPACHADA',
  RECHAZADA:                'RECHAZADA',
  RECHAZADA_POR_STOCK:      'RECHAZADA_POR_STOCK',
  RECHAZADA_POR_VALIDACION: 'RECHAZADA_POR_VALIDACION',
  RETIRADA:                 'RETIRADA',
});

class Despacho {
  constructor({ id, idEventoOrigen, idPrescripcionClinica, idEncuentroClinico, idPaciente,
                idFarmacia, estado, contenido, fechaEmision, fechaDespacho, fechaRetiro,
                referenciaFarmacia, observacionFarmacia, motivoRechazo, intentosEnvio, correlationId }) {
    this.id = id;
    this.idEventoOrigen = idEventoOrigen;
    this.idPrescripcionClinica = idPrescripcionClinica;
    this.idEncuentroClinico = idEncuentroClinico;
    this.idPaciente = idPaciente;
    this.idFarmacia = idFarmacia;
    this.estado = estado || ESTADOS.CREADA;
    this.contenido = contenido || null; // medicamento, dosis, etc. Necesario para reintentos.
    this.fechaEmision = fechaEmision || new Date();
    this.fechaDespacho = fechaDespacho || null;
    this.fechaRetiro = fechaRetiro || null;
    this.referenciaFarmacia = referenciaFarmacia || null;
    this.observacionFarmacia = observacionFarmacia || null;
    this.motivoRechazo = motivoRechazo || null;
    this.intentosEnvio = intentosEnvio || 0;
    this.correlationId = correlationId || null;
  }

  static ESTADOS = ESTADOS;

  registrarIntentoEnvio() {
    this.intentosEnvio += 1;
  }

  marcarDespachada({ referenciaFarmacia, observacionFarmacia }) {
    this.estado = ESTADOS.DESPACHADA;
    this.fechaDespacho = new Date();
    this.referenciaFarmacia = referenciaFarmacia || null;
    this.observacionFarmacia = observacionFarmacia || null;
  }

  marcarRechazada(motivoRechazo) {
    this.estado = ESTADOS.RECHAZADA;
    this.motivoRechazo = motivoRechazo;
  }

  marcarRechazadaPorStock(motivoRechazo) {
    this.estado = ESTADOS.RECHAZADA_POR_STOCK;
    this.motivoRechazo = motivoRechazo;
  }

  marcarRechazadaPorValidacion(motivoRechazo) {
    this.estado = ESTADOS.RECHAZADA_POR_VALIDACION;
    this.motivoRechazo = motivoRechazo;
  }

  reintentar() {
    const estadosReiniciables = [
      ESTADOS.RECHAZADA,
      ESTADOS.RECHAZADA_POR_STOCK,
      ESTADOS.RECHAZADA_POR_VALIDACION,
    ];
    if (!estadosReiniciables.includes(this.estado)) {
      throw new DomainError('RECETA_NO_RECHAZADA', 409,
        `Solo se pueden reintentar despachos en estado RECHAZADA. Estado actual: ${this.estado}.`);
    }
    this.estado = ESTADOS.CREADA;
    this.motivoRechazo = null;
  }

  marcarRetirada() {
    if (this.estado !== ESTADOS.DESPACHADA) {
      throw new DomainError('RECETA_NO_DESPACHADA', 409,
        `Solo se pueden retirar despachos en estado DESPACHADA. Estado actual: ${this.estado}.`);
    }
    this.estado = ESTADOS.RETIRADA;
    this.fechaRetiro = new Date();
  }

  toDTO() {
    return {
      idReceta: this.id,
      idEncuentroClinico: this.idEncuentroClinico,
      idPaciente: this.idPaciente,
      estado: this.estado,
      fechaEmision: this.fechaEmision,
      fechaDespacho: this.fechaDespacho,
      farmacia: this.idFarmacia,
      observacionFarmacia: this.observacionFarmacia,
      correlationId: this.correlationId
    };
  }
}

module.exports = Despacho;
