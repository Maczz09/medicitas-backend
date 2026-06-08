const { ValidationError } = require('../../../../shared/domain/errors');
const { CitaNoEncontradaError, ColisionHorarioError, DesincronizacionCacheError } = require('../../domain/cita.errors');

class ReprogramarCitaUseCase {
  constructor({ citasRepository, disponibilidadCache, eventPublisher, getConnection }) {
    this.citasRepo = citasRepository;
    this.disponibilidadCache = disponibilidadCache;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar({ idCita, nuevaFechaHora, idMedico }, correlationId) {
    if (!nuevaFechaHora) {
      throw new ValidationError('nuevaFechaHora es obligatoria', 'DATOS_INVALIDOS');
    }

    const cita = await this.citasRepo.findById(idCita);
    if (!cita) {
      throw new CitaNoEncontradaError(`Cita ${idCita} no encontrada`);
    }

    const medicoDestino = idMedico || cita.idMedico;
    const fechaNueva = new Date(nuevaFechaHora);

    const disponible = await this.disponibilidadCache.verificarDisponibilidad(medicoDestino, fechaNueva);
    if (!disponible) {
      throw new ColisionHorarioError('El nuevo slot no está disponible');
    }

    const { fechaAnterior } = cita.reprogramar(fechaNueva); // Validates transition
    const medicoAnterior = cita.idMedico;
    cita.idMedico = medicoDestino;

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      const [colision] = await conn.execute(
        `SELECT id FROM svc_cit.citas
         WHERE id_medico = ? AND fecha_hora = ?
           AND estado NOT IN ('Cancelada', 'No_Asistida')
           AND id != ?
         FOR UPDATE`,
        [medicoDestino, fechaNueva, cita.id]
      );
      if (colision.length > 0) {
        await conn.rollback();
        throw new DesincronizacionCacheError('El slot fue tomado por otro proceso justo antes de reprogramar');
      }

      await this.citasRepo.update(cita, conn);

      await this.eventPublisher.publish(conn, 'CitaReprogramada', {
        idCita: cita.id,
        idPaciente: cita.idPaciente,
        idMedicoAnterior: medicoAnterior,
        idMedicoNuevo: cita.idMedico,
        fechaAnterior: fechaAnterior.toISOString(),
        fechaNueva: cita.fechaHora.toISOString(),
      }, correlationId);

      await conn.commit();

      await Promise.allSettled([
        this.disponibilidadCache.liberarSlot(medicoAnterior, fechaAnterior),
        this.disponibilidadCache.marcarOcupado(cita.idMedico, cita.fechaHora),
      ]);

    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return {
      idCita: cita.id,
      estado: cita.estado,
      nuevaFechaHora: cita.fechaHora.toISOString(),
      mensaje: 'Cita reprogramada. Notificación de cambio encolada.',
      correlationId,
    };
  }
}

module.exports = { ReprogramarCitaUseCase };
