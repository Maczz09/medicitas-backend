const { HorarioSemana } = require('../../domain/entities/HorarioSemana');
const { MedicoNoEncontradoError } = require('../../domain/horarios.errors');
const { invalidarCacheDisponibilidad } = require('../../infrastructure/invalidarCacheDisponibilidad');

// Fase 2 del plan: define (crea o reemplaza por completo) el horario de UNA
// semana específica de un médico. A diferencia de DefinirPlantillaUseCase,
// esto no toca la plantilla — una vez que existe una fila en horarios_semana
// para esa semana, ES la fuente de verdad completa para esa semana (ver
// HorarioSemana / ResolverHorarioEfectivoUseCase).
class DefinirHorarioSemanaUseCase {
  constructor({ medicoValidatorPort, horariosRepository, eventPublisher, getConnection }) {
    this.medicoValidator = medicoValidatorPort;
    this.horariosRepo = horariosRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar(idMedico, semanaInicio, diasDto, correlationId) {
    const existe = await this.medicoValidator.existeMedicoActivo(idMedico);
    if (!existe) throw new MedicoNoEncontradoError();

    const semana = HorarioSemana.crear({
      idMedico,
      semanaInicio,
      dias: (diasDto || []).map((d) => ({
        diaSemana: d.dia_semana,
        horaInicio: d.hora_inicio,
        horaFin: d.hora_fin,
        duracionCitaMin: d.duracion_cita_min,
        activo: d.activo !== false,
      })),
    });

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.horariosRepo.reemplazarSemana(semana, conn);
      await this.eventPublisher.publish(
        conn,
        'HorarioSemanaDefinido',
        { idMedico, semanaInicio: semana.semanaInicio, dias: diasDto },
        correlationId,
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // La agenda cambió → invalidar la caché de disponibilidad de citas (si no,
    // las reservas se validan contra la agenda VIEJA hasta 5 minutos).
    await invalidarCacheDisponibilidad(idMedico);

    return semana;
  }
}

module.exports = { DefinirHorarioSemanaUseCase };
