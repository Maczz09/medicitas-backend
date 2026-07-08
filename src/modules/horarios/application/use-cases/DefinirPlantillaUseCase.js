const { PlantillaHorario } = require('../../domain/entities/PlantillaHorario');
const { MedicoNoEncontradoError } = require('../../domain/horarios.errors');

// Migrado de medicos.usecases.js#registrarHorarios. Reemplazo total de la
// plantilla (igual semántica que el saveHorarios viejo: DELETE + re-INSERT
// transaccional) — sigue siendo la operación correcta para "esta es tu
// plantilla desde ahora", que es distinta de "define esta semana puntual"
// (DefinirHorarioSemanaUseCase).
class DefinirPlantillaUseCase {
  constructor({ medicoValidatorPort, horariosRepository, eventPublisher, getConnection, logger }) {
    this.medicoValidator = medicoValidatorPort;
    this.horariosRepo = horariosRepository;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
    this.logger = logger;
  }

  async ejecutar(idMedico, horariosDto, correlationId) {
    const existe = await this.medicoValidator.existeMedicoActivo(idMedico);
    if (!existe) throw new MedicoNoEncontradoError();

    const plantilla = (horariosDto || []).map((h) =>
      PlantillaHorario.crear({
        idMedico,
        diaSemana: h.dia_semana,
        horaInicio: h.hora_inicio,
        horaFin: h.hora_fin,
        duracionCitaMin: h.duracion_cita_min,
      }),
    );

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.horariosRepo.reemplazarPlantilla(idMedico, plantilla, conn);
      await this.eventPublisher.publish(
        conn,
        'PlantillaHorarioActualizada',
        { idMedico, horarios: horariosDto },
        correlationId,
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { DefinirPlantillaUseCase };
