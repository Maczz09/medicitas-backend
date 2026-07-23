const { CitaNoEncontradaError } = require('../../domain/cita.errors');
const { DomainError } = require('../../../../shared/domain/errors');
const logger = require('../../../../shared/logger/logger');

class RegistrarIngresoUseCase {
  constructor({ citasRepository, eventPublisher, getConnection, pagoValidator }) {
    this.citasRepo = citasRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
    this.pagoValidator = pagoValidator; // adaptador S2S opcional hacia Pagos
    // Regla de negocio configurable: exigir pago aprobado antes del ingreso.
    // Default OFF para no bloquear flujos/demos donde el pago se registra
    // después; se activa con REQUERIR_PAGO_PARA_INGRESO=true.
    this.requerirPago = process.env.REQUERIR_PAGO_PARA_INGRESO === 'true';
  }

  async ejecutar({ idCita }, correlationId) {
    const cita = await this.citasRepo.findById(idCita);
    if (!cita) {
      throw new CitaNoEncontradaError(`Cita ${idCita} no encontrada`);
    }

    // Precondición de negocio: la cita debe estar pagada para registrar el
    // ingreso. Evita que un paciente sea atendido sin haber pagado.
    let pagoDisponible = true; // false solo si Citas→Pagos estaba inalcanzable
    if (this.requerirPago && this.pagoValidator) {
      let pago = null;
      try {
        pago = await this.pagoValidator.obtenerPagoDeCita(idCita);
      } catch (err) {
        // Fail-safe: si Pagos no responde, NO bloqueamos el ingreso (la
        // atención clínica no debe depender de la disponibilidad de Pagos);
        // se persiste pago_verificado=0 para que el recovery-replay de
        // citas.routes.js lo reconcilie en cuanto Pagos se recupere.
        pagoDisponible = false;
        logger.warn({ idCita, err: err.message }, 'No se pudo verificar el pago antes del ingreso — se permite por fail-safe, queda pendiente de reconciliar');
      }

      // Solo evaluamos el resultado si Pagos SÍ respondió — si no respondió,
      // `pago` seguiría en null pero NO significa "no hay pago", significa
      // "no sabemos". Antes este `if` se evaluaba siempre y por eso un
      // timeout de Pagos terminaba bloqueando el ingreso igual que un 404
      // real (bug: contradecía el comentario de fail-safe de arriba).
      if (pagoDisponible) {
        if (pago && pago.estado === 'REVERSADO') {
          throw new DomainError('CITA_SIN_PAGO_VIGENTE', 409, 'El pago de esta cita fue reversado. No se puede registrar el ingreso.');
        }
        if (pago === null) {
          throw new DomainError('CITA_NO_PAGADA', 409, 'La cita no tiene un pago registrado. Debe cobrarse antes del ingreso.');
        }
      }
    }

    cita.registrarIngreso(); // Entidad valida la transición
    if (!pagoDisponible) {
      cita.marcarPagoNoVerificado();
    }

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      await this.citasRepo.update(cita, conn);

      await this.eventPublisher.publish(conn, 'IngresoRegistrado', {
        idCita: cita.id,
        idPaciente: cita.idPaciente,
        idMedico: cita.idMedico,
        fechaHoraCita: cita.fechaHora.toISOString(),
        timestampIngreso: new Date().toISOString(),
        pagoVerificado: cita.pagoVerificado,
      }, correlationId);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return {
      idCita: cita.id,
      estado: cita.estado,
      mensaje: 'Ingreso registrado. El médico puede iniciar la consulta.',
      correlationId,
    };
  }
}

module.exports = { RegistrarIngresoUseCase };
