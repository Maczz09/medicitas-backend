const { SemanaISO } = require('../../domain/value-objects/SemanaISO');

/**
 * El corazón del módulo: dado un médico y una fecha, resuelve QUÉ horario
 * aplica ese día — la ÚNICA implementación de esta pregunta en todo el
 * sistema. La consumen tanto ConsultarSlotsUseCase (para el frontend) como
 * el adaptador que `citas` inyectará en su propio puerto de disponibilidad
 * (fase 4 del plan) — antes había DOS implementaciones independientes y
 * ligeramente distintas de esta misma pregunta (medicos.getSlotsForDate vs
 * citas.MedicoDisponibilidadDBAdapter), y la segunda ni siquiera miraba
 * bloqueos_agenda.
 *
 * Regla de resolución: si existe una fila en horarios_semana para la semana
 * de `fecha`, esa semana es la fuente de verdad completa — un día sin fila
 * en horarios_semana_dias está inactivo ese día, punto (no cae a la
 * plantilla día por día). Si no existe la semana en absoluto, se usa la
 * plantilla recurrente como respaldo.
 */
class ResolverHorarioEfectivoUseCase {
  constructor({ horariosRepository }) {
    this.horariosRepo = horariosRepository;
  }

  /**
   * @returns {Promise<{horaInicio:string, horaFin:string, duracionCitaMin:number, origen:'SEMANA'|'PLANTILLA'} | null>}
   */
  async ejecutar(idMedico, fecha) {
    const fechaDate = fecha instanceof Date ? fecha : new Date(`${fecha}T00:00:00`);
    const diaSemana = fechaDate.getDay();
    const semanaInicio = new SemanaISO(fechaDate).toString();

    const semana = await this.horariosRepo.findSemana(idMedico, semanaInicio);
    if (semana) {
      const dia = semana.diaConfig(diaSemana);
      return dia ? { ...dia, origen: 'SEMANA' } : null;
    }

    const plantilla = await this.horariosRepo.findPlantillaDia(idMedico, diaSemana);
    if (!plantilla || !plantilla.activo) return null;

    return {
      diaSemana,
      horaInicio: plantilla.horaInicio,
      horaFin: plantilla.horaFin,
      duracionCitaMin: plantilla.duracionCitaMin,
      origen: 'PLANTILLA',
    };
  }
}

module.exports = { ResolverHorarioEfectivoUseCase };
