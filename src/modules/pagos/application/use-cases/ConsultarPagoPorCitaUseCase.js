const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarPagoPorCitaUseCase {
  constructor({ pagosRepository }) {
    this.pagosRepo = pagosRepository;
  }

  async ejecutar(idCita) {
    if (!idCita) {
      throw new DomainError('DATOS_INVALIDOS', 400, 'idCita es requerido');
    }

    const pago = await this.pagosRepo.findByIdCita(idCita);
    
    if (!pago) {
      return null;
    }

    return {
      idPago:              pago.id,
      idCita:              pago.idCita,
      idPaciente:          pago.idPaciente,
      estado:              pago.estado,
      metodoPago:          pago.metodoPago,
      montoTotal:          pago.montoTotal,
      montoCubiertoSeguro: pago.montoCubiertoSeguro,
      montoCopago:         pago.montoCopago,
      tipoComprobante:     pago.tipoComprobante,
      observaciones:       pago.observaciones,
      correlationId:       pago.correlationId,
    };
  }
}

module.exports = { ConsultarPagoPorCitaUseCase };
