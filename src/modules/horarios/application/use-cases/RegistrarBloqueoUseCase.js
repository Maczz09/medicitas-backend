const { Bloqueo } = require('../../domain/entities/Bloqueo');
const { MedicoNoEncontradoError } = require('../../domain/horarios.errors');
const { invalidarCacheDisponibilidad } = require('../../infrastructure/invalidarCacheDisponibilidad');

// Migrado de medicos.usecases.js#registrarBloqueo.
class RegistrarBloqueoUseCase {
  constructor({ medicoValidatorPort, horariosRepository, eventPublisher, getConnection }) {
    this.medicoValidator = medicoValidatorPort;
    this.horariosRepo = horariosRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar(idMedico, bloqueoDto, correlationId) {
    const existe = await this.medicoValidator.existeMedicoActivo(idMedico);
    if (!existe) throw new MedicoNoEncontradoError();

    const bloqueo = Bloqueo.crear({
      idMedico,
      fechaInicio: bloqueoDto.fecha_inicio,
      fechaFin: bloqueoDto.fecha_fin,
      motivo: bloqueoDto.motivo,
    });

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.horariosRepo.guardarBloqueo(bloqueo, conn);
      await this.eventPublisher.publish(
        conn,
        'BloqueoRegistrado',
        {
          idMedico,
          idBloqueo: bloqueo.idBloqueo,
          fechaInicio: bloqueo.fechaInicio.toISOString(),
          fechaFin: bloqueo.fechaFin.toISOString(),
          motivo: bloqueo.motivo,
        },
        correlationId,
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Un bloqueo nuevo debe reflejarse al instante en las reservas (si no, la
    // caché de disponibilidad sigue ofreciendo las horas recién bloqueadas).
    await invalidarCacheDisponibilidad(idMedico);

    return bloqueo;
  }
}

module.exports = { RegistrarBloqueoUseCase };
