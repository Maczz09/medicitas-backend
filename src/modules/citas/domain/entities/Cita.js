const { TransicionEstadoInvalidaError, FechaHoraInvalidaError } = require('../cita.errors');

const CitaEstado = Object.freeze({
  PENDIENTE:     'Pendiente',
  EN_ATENCION:   'En_Atencion',
  COMPLETADA:    'Completada',
  CANCELADA:     'Cancelada',
  NO_ASISTIDA:   'No_Asistida',
});

class Cita {
  constructor({ id, idPaciente, idMedico, fechaHora, especialidad, estado, correlationId, recordatorio30m, alertaMin0, alertaMin5, alertaMin10 }) {
    this.id            = id;
    this.idPaciente    = idPaciente;
    this.idMedico      = idMedico;
    this.fechaHora     = fechaHora instanceof Date ? fechaHora : new Date(fechaHora);
    this.especialidad  = especialidad;
    this.estado        = estado || CitaEstado.PENDIENTE;
    this.correlationId = correlationId || null;
    
    // Flags de tolerance worker
    this.recordatorio30m = recordatorio30m || false;
    this.alertaMin0    = alertaMin0 || false;
    this.alertaMin5    = alertaMin5 || false;
    this.alertaMin10   = alertaMin10 || false;
  }

  static crear({ idPaciente, idMedico, fechaHora, especialidad, correlationId }) {
    // Generate an ID for the Cita. The ID can be handled by the repo, but the document generates it here.
    const id = `CIT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return new Cita({
      id, idPaciente, idMedico, fechaHora,
      especialidad, estado: CitaEstado.PENDIENTE, correlationId,
    });
  }

  registrarIngreso() {
    if (this.estado !== CitaEstado.PENDIENTE) {
      throw new TransicionEstadoInvalidaError(
        `Solo se puede registrar ingreso desde 'Pendiente'. Estado actual: ${this.estado}`
      );
    }
    // Solo se puede registrar ingreso el mismo día de la cita (zona horaria del servidor = Lima)
    const ahora = new Date();
    const mismoAnio  = ahora.getFullYear() === this.fechaHora.getFullYear();
    const mismoMes   = ahora.getMonth()    === this.fechaHora.getMonth();
    const mismoDia   = ahora.getDate()     === this.fechaHora.getDate();
    if (!(mismoAnio && mismoMes && mismoDia)) {
      const fechaStr = this.fechaHora.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
      throw new TransicionEstadoInvalidaError(
        `Solo se puede registrar ingreso el día de la cita (${fechaStr})`
      );
    }
    this.estado = CitaEstado.EN_ATENCION;
    return this;
  }

  completar() {
    if (this.estado !== CitaEstado.EN_ATENCION) {
      throw new TransicionEstadoInvalidaError(
        `Solo se puede completar desde 'En_Atencion'. Estado actual: ${this.estado}`
      );
    }
    this.estado = CitaEstado.COMPLETADA;
    return this;
  }

  cancelar() {
    const estadosCancelables = [CitaEstado.PENDIENTE, CitaEstado.EN_ATENCION];
    if (!estadosCancelables.includes(this.estado)) {
      throw new TransicionEstadoInvalidaError(
        `No se puede cancelar una cita en estado '${this.estado}'`
      );
    }
    this.estado = CitaEstado.CANCELADA;
    return this;
  }

  revertirIngreso() {
    if (this.estado !== CitaEstado.EN_ATENCION) {
      throw new TransicionEstadoInvalidaError(
        `Solo se puede revertir el ingreso desde 'En_Atencion'. Estado actual: ${this.estado}`
      );
    }
    this.estado = CitaEstado.PENDIENTE;
    return this;
  }

  expirar() {
    if (this.estado !== CitaEstado.PENDIENTE) return null;
    this.estado = CitaEstado.NO_ASISTIDA;
    return this;
  }

  reprogramar(nuevaFechaHora) {
    if (this.estado !== CitaEstado.PENDIENTE) {
      throw new TransicionEstadoInvalidaError(
        `Solo se puede reprogramar desde 'Pendiente'. Estado actual: ${this.estado}`
      );
    }
    const nueva = nuevaFechaHora instanceof Date ? nuevaFechaHora : new Date(nuevaFechaHora);
    if (nueva <= new Date()) {
      throw new FechaHoraInvalidaError('La nueva fecha y hora debe ser en el futuro');
    }
    const fechaAnterior = this.fechaHora;
    this.fechaHora = nueva;
    return { fechaAnterior, fechaNueva: nueva };
  }

  estaActiva() {
    return this.estado === CitaEstado.PENDIENTE || this.estado === CitaEstado.EN_ATENCION;
  }
}

module.exports = { Cita, CitaEstado };
