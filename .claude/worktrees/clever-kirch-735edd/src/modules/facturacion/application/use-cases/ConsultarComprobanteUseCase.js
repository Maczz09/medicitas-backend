const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarComprobanteUseCase {
  constructor({ comprobantesRepository }) {
    this.repo = comprobantesRepository;
  }

  async porId(id) {
    const comp = await this.repo.findById(id);
    if (!comp) throw new DomainError('COMPROBANTE_NO_ENCONTRADO', 404, 'Comprobante no encontrado');
    return this._format(comp);
  }

  async porPago(idPago) {
    const comp = await this.repo.findByIdPago(idPago);
    if (!comp) throw new DomainError('COMPROBANTE_NO_ENCONTRADO', 404, 'Comprobante no encontrado para este pago');
    return this._format(comp);
  }

  async obtenerPdfPath(id) {
    const comp = await this.repo.findById(id);
    if (!comp) throw new DomainError('COMPROBANTE_NO_ENCONTRADO', 404, 'Comprobante no encontrado');
    if (!comp.estaEmitido() || !comp.rutaPdf) {
      throw new DomainError('PDF_NO_DISPONIBLE', 404, 'El PDF del comprobante aún no está disponible');
    }
    return comp.rutaPdf;
  }

  _format(comp) {
    if (comp.estaPendiente()) {
      return {
        idComprobante: comp.id,
        idPago: comp.idPago,
        estado: 'PENDIENTE',
        mensaje: 'El comprobante está siendo generado. Espere unos segundos.',
        correlationId: comp.correlationId
      };
    }
    return {
      idComprobante: comp.id,
      idPago: comp.idPago,
      idPaciente: comp.idPaciente,
      idCita: comp.idCita,
      tipo: comp.tipo,
      numero: comp.numero,
      montoTotal: comp.montoTotal,
      montoCubiertoSeguro: comp.montoCubiertoSeguro,
      montoCopago: comp.montoCopago,
      metodoPago: comp.metodoPago,
      tieneCobertura: comp.tieneCobertura,
      estado: comp.estado,
      urlDescarga: comp.urlDescarga,
      correlationId: comp.correlationId
    };
  }
}

module.exports = { ConsultarComprobanteUseCase };
