const { EstadoCobertura } = require('../value-objects/EstadoCobertura');

class Cobertura {
  constructor({
    id, idPaciente, idAseguradora, numeroPoliza,
    tipoConsulta, estadoCobertura, porcentajeCobertura,
    codigoAutorizacion, vigencia, esFallback, correlationId,
  }) {
    this.id                  = id;
    this.idPaciente          = idPaciente;
    this.idAseguradora       = idAseguradora;
    this.numeroPoliza        = numeroPoliza;
    this.tipoConsulta        = tipoConsulta;
    this.estadoCobertura     = estadoCobertura;
    this.porcentajeCobertura = porcentajeCobertura || 0;
    this.codigoAutorizacion  = codigoAutorizacion  || null;
    this.vigencia            = vigencia            || null;
    this.esFallback          = esFallback          || false;
    this.correlationId       = correlationId       || null;
  }

  static crear({ idPaciente, idAseguradora, numeroPoliza, tipoConsulta,
                 estadoCobertura, porcentajeCobertura, codigoAutorizacion,
                 vigencia, esFallback, correlationId }) {
    // Sufijo aleatorio además del timestamp: bajo carga, dos validaciones en el
    // mismo milisegundo generaban el MISMO COB-<ts> → Duplicate entry en la PK
    // (500 intermitente). Mismo patrón anti-colisión que Cita (CIT-<ts>-<rand>).
    const id = `COB-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Cobertura({
      id, idPaciente, idAseguradora, numeroPoliza, tipoConsulta,
      estadoCobertura, porcentajeCobertura, codigoAutorizacion,
      vigencia, esFallback, correlationId,
    });
  }

  // ── Métodos de consulta (lógica de dominio, no en el use case) ────────────
  estaAprobada()  { return this.estadoCobertura === EstadoCobertura.APROBADA; }
  estaRechazada() { return this.estadoCobertura === EstadoCobertura.RECHAZADA; }
  estaPendiente() { return this.estadoCobertura === EstadoCobertura.PENDIENTE; }

  // Indica si el resultado aún es válido para SVC-PAG-004
  // Una validación aprobada expira a los 15 minutos
  estaVigente(createdAt) {
    if (!this.estaAprobada()) return false;
    const ahora        = new Date();
    const creadaEn     = new Date(createdAt);
    const minutosVivos = (ahora - creadaEn) / 1000 / 60;
    return minutosVivos < 15;
  }

  // El evento a publicar depende del estado de la cobertura
  eventoAPublicar() {
    if (this.estaAprobada())  return 'CoberturaValidada';
    if (this.estaRechazada()) return 'CoberturaRechazada';
    return 'CoberturaPendiente';
  }
}

module.exports = { Cobertura };
