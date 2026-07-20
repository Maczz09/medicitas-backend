const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarPagoUseCase {
  constructor({ pagosRepository }) {
    this.pagosRepo = pagosRepository;
  }

  async ejecutar(idPago) {
    if (!idPago) {
      throw new DomainError('DATOS_INVALIDOS', 400, 'idPago es requerido');
    }

    const pago = await this.pagosRepo.findById(idPago);
    
    if (!pago) {
      throw new DomainError('PAGO_NO_ENCONTRADO', 404, `El pago ${idPago} no existe`);
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

module.exports = { ConsultarPagoUseCase };
