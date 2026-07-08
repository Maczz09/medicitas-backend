const { IHorariosRepository } = require('../../../ports/out');
const { PlantillaHorario } = require('../../../domain/entities/PlantillaHorario');
const { HorarioSemana } = require('../../../domain/entities/HorarioSemana');
const { Bloqueo } = require('../../../domain/entities/Bloqueo');
const pool = require('../../../../../config/database');

class HorariosMySQLRepository extends IHorariosRepository {
  async findSemana(idMedico, semanaInicio) {
    const [semanas] = await pool.query(
      `SELECT id_semana FROM svc_hor.horarios_semana WHERE id_medico = ? AND semana_inicio = ?`,
      [idMedico, semanaInicio],
    );
    if (semanas.length === 0) return null;

    const idSemana = semanas[0].id_semana;
    const [dias] = await pool.query(
      `SELECT dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo
       FROM svc_hor.horarios_semana_dias WHERE id_semana = ?`,
      [idSemana],
    );

    return new HorarioSemana({
      idSemana,
      idMedico,
      semanaInicio,
      dias: dias.map((d) => ({
        diaSemana: d.dia_semana,
        horaInicio: d.hora_inicio,
        horaFin: d.hora_fin,
        duracionCitaMin: d.duracion_cita_min,
        activo: !!d.activo,
      })),
    });
  }

  async findPlantillaDia(idMedico, diaSemana) {
    const [rows] = await pool.query(
      `SELECT id_plantilla, dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo
       FROM svc_hor.plantillas_horario WHERE id_medico = ? AND dia_semana = ? AND activo = 1 LIMIT 1`,
      [idMedico, diaSemana],
    );
    if (rows.length === 0) return null;
    return HorariosMySQLRepository._mapPlantilla(rows[0], idMedico);
  }

  async findPlantillaCompleta(idMedico) {
    const [rows] = await pool.query(
      `SELECT id_plantilla, dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo
       FROM svc_hor.plantillas_horario WHERE id_medico = ? AND activo = 1`,
      [idMedico],
    );
    return rows.map((r) => HorariosMySQLRepository._mapPlantilla(r, idMedico));
  }

  async findBloqueosEnFecha(idMedico, fecha) {
    const [rows] = await pool.query(
      `SELECT id_bloqueo, fecha_inicio, fecha_fin, motivo FROM svc_hor.bloqueos_agenda
       WHERE id_medico = ? AND fecha_inicio < ? AND fecha_fin > ?`,
      [idMedico, `${fecha} 23:59:59`, `${fecha} 00:00:00`],
    );
    return rows.map((r) => HorariosMySQLRepository._mapBloqueo(r, idMedico));
  }

  async findBloqueosFuturos(idMedico) {
    const [rows] = await pool.query(
      `SELECT id_bloqueo, fecha_inicio, fecha_fin, motivo FROM svc_hor.bloqueos_agenda
       WHERE id_medico = ? AND fecha_fin >= NOW()`,
      [idMedico],
    );
    return rows.map((r) => HorariosMySQLRepository._mapBloqueo(r, idMedico));
  }

  // Reemplazo total (DELETE + re-INSERT) — misma semántica que el
  // saveHorarios() viejo de medicos.usecases.js.
  async reemplazarPlantilla(idMedico, plantilla, connection) {
    await connection.execute(`DELETE FROM svc_hor.plantillas_horario WHERE id_medico = ?`, [idMedico]);
    for (const p of plantilla) {
      await connection.execute(
        `INSERT INTO svc_hor.plantillas_horario
           (id_plantilla, id_medico, dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [p.idPlantilla, idMedico, p.diaSemana, p.horaInicio, p.horaFin, p.duracionCitaMin],
      );
    }
  }

  // Upsert del padre por clave natural (id_medico, semana_inicio) —
  // preserva el id_semana existente si ya había una fila, para no dejar
  // huérfanas las filas hijas de una edición previa de la misma semana.
  async reemplazarSemana(horarioSemana, connection) {
    const [existente] = await connection.execute(
      `SELECT id_semana FROM svc_hor.horarios_semana WHERE id_medico = ? AND semana_inicio = ?`,
      [horarioSemana.idMedico, horarioSemana.semanaInicio],
    );
    const idSemana = existente[0]?.id_semana || horarioSemana.idSemana;

    if (existente.length > 0) {
      await connection.execute(
        `UPDATE svc_hor.horarios_semana SET updated_at = CURRENT_TIMESTAMP WHERE id_semana = ?`,
        [idSemana],
      );
    } else {
      await connection.execute(
        `INSERT INTO svc_hor.horarios_semana (id_semana, id_medico, semana_inicio) VALUES (?, ?, ?)`,
        [idSemana, horarioSemana.idMedico, horarioSemana.semanaInicio],
      );
    }

    await connection.execute(`DELETE FROM svc_hor.horarios_semana_dias WHERE id_semana = ?`, [idSemana]);
    for (const dia of horarioSemana.dias) {
      if (!dia.activo) continue; // igual que la plantilla: un día inactivo simplemente no se guarda
      await connection.execute(
        `INSERT INTO svc_hor.horarios_semana_dias
           (id_dia, id_semana, dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo)
         VALUES (UUID(), ?, ?, ?, ?, ?, 1)`,
        [idSemana, dia.diaSemana, dia.horaInicio, dia.horaFin, dia.duracionCitaMin],
      );
    }

    horarioSemana.idSemana = idSemana;
  }

  async guardarBloqueo(bloqueo, connection) {
    await connection.execute(
      `INSERT INTO svc_hor.bloqueos_agenda (id_bloqueo, id_medico, fecha_inicio, fecha_fin, motivo)
       VALUES (?, ?, ?, ?, ?)`,
      [bloqueo.idBloqueo, bloqueo.idMedico, bloqueo.fechaInicio, bloqueo.fechaFin, bloqueo.motivo],
    );
  }

  static _mapPlantilla(r, idMedico) {
    return new PlantillaHorario({
      idPlantilla: r.id_plantilla,
      idMedico,
      diaSemana: r.dia_semana,
      horaInicio: r.hora_inicio,
      horaFin: r.hora_fin,
      duracionCitaMin: r.duracion_cita_min,
      activo: !!r.activo,
    });
  }

  static _mapBloqueo(r, idMedico) {
    return new Bloqueo({
      idBloqueo: r.id_bloqueo,
      idMedico,
      fechaInicio: r.fecha_inicio,
      fechaFin: r.fecha_fin,
      motivo: r.motivo,
    });
  }
}

module.exports = { HorariosMySQLRepository };
