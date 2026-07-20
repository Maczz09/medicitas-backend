const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarValidacionUseCase {
  constructor({ coberturaRepository }) {
    this.coberturaRepo = coberturaRepository;
  }

  async ejecutar(idValidacion) {
    if (!idValidacion) {
      throw new DomainError('DATOS_INVALIDOS', 400, 'idValidacion es requerido');
    }

    const cobertura = await this.coberturaRepo.findById(idValidacion);
    
    if (!cobertura) {
      throw new DomainError('VALIDACION_NO_ENCONTRADA', 404, `No se encontró la validación ${idValidacion}`);
    }

    return {
      idValidacion:        cobertura.id,
      idPaciente:          cobertura.idPaciente,
      idAseguradora:       cobertura.idAseguradora,
      numeroPoliza:        cobertura.numeroPoliza,
      tipoConsulta:        cobertura.tipoConsulta,
      estadoCobertura:     cobertura.estadoCobertura,
      porcentajeCobertura: cobertura.porcentajeCobertura,
      codigoAutorizacion:  cobertura.codigoAutorizacion,
      vigencia:            cobertura.vigencia,
      esFallback:          cobertura.esFallback,
      correlationId:       cobertura.correlationId,
    };
  }
}

module.exports = { ConsultarValidacionUseCase };
