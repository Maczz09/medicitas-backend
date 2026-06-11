const { DomainError } = require('../../../../shared/domain/errors');
const logger = require('../../../../shared/logger/logger');

class ReversarPagoUseCase {
  constructor({ pagosRepository, eventPublisher, getConnection }) {
    this.pagosRepo      = pagosRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection  = getConnection;
  }

  async ejecutar({ idPago, motivo }, correlationId) {
    if (!motivo || motivo.trim().length === 0) {
      throw new DomainError('DATOS_INVALIDOS', 400, 'El motivo de reversión es obligatorio');
    }

    const pago = await this.pagosRepo.findById(idPago);
    if (!pago) {
      throw new DomainError('PAGO_NO_ENCONTRADO', 404, `El pago ${idPago} no existe`);
    }

    pago.reversar(motivo); // La entidad valida la transición de estado

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      await this.pagosRepo.update(pago, conn);

      await this.eventPublisher.publish(conn, 'PagoReversado', {
        idPago:     pago.id,
        idCita:     pago.idCita,
        idPaciente: pago.idPaciente,
        montoTotal: pago.montoTotal,
        motivo:     motivo.trim(),
      }, correlationId);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      if (err.code && err.httpStatus) throw err;
      logger.error({ err, idPago, correlationId }, 'Error al reversar pago');
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al reversar el pago');
    } finally {
      conn.release();
    }

    return {
      idPago:  pago.id,
      estado:  pago.estado,
      motivo:  motivo.trim(),
      mensaje: 'Pago reversado. La devolución física debe gestionarse en caja.',
      correlationId,
    };
  }
}

module.exports = { ReversarPagoUseCase };
