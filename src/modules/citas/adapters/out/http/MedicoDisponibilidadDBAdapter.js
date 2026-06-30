const { IMedicoDisponibilidadPort } = require('../../../ports/out');
const db = require('../../../../../config/database');

/**
 * Lee el horario real del médico desde horarios_base y genera los slots disponibles.
 * Reemplaza al MedicoDisponibilidadMockAdapter que tenía slots hardcodeados 08-17:30.
 */
class MedicoDisponibilidadDBAdapter extends IMedicoDisponibilidadPort {
  async obtenerDisponibilidad(idMedico, fecha) {
    try {
      // dia_semana: 0=Dom, 1=Lun … 6=Sáb (igual que JS getDay() con TZ local)
      const fechaDate = new Date(`${fecha}T00:00:00`);
      const diaSemana = fechaDate.getDay();

      const [horarios] = await db.query(
        `SELECT hora_inicio, hora_fin, duracion_cita_min
         FROM svc_med.horarios_base
         WHERE id_medico = ? AND dia_semana = ? AND activo = 1
         LIMIT 1`,
        [idMedico, diaSemana]
      );

      if (!horarios.length) return null; // sin horario → cache no se pobla → fallback optimista

      const { hora_inicio, hora_fin, duracion_cita_min: duracion } = horarios[0];

      const [hIni, mIni] = hora_inicio.split(':').map(Number);
      const [hFin, mFin] = hora_fin.split(':').map(Number);

      let cur = hIni * 60 + mIni;
      const fin = hFin * 60 + mFin;
      const slots = [];

      while (cur < fin) {
        const next = cur + duracion;
        const hh    = String(Math.floor(cur / 60)).padStart(2, '0');
        const mm    = String(cur % 60).padStart(2, '0');
        const hhFin = String(Math.floor(next / 60)).padStart(2, '0');
        const mmFin = String(next % 60).padStart(2, '0');

        slots.push({
          horaInicio: `${hh}:${mm}`,
          horaFin:    `${hhFin}:${mmFin}`,
          disponible: true,
        });

        cur = next;
      }

      return slots;
    } catch (err) {
      console.warn('[MedicoDisponibilidadDBAdapter] Error leyendo horario:', err.message);
      return null; // fallback optimista
    }
  }
}

module.exports = { MedicoDisponibilidadDBAdapter };
