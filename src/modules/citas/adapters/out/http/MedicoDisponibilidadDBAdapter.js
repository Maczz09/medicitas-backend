const { IMedicoDisponibilidadPort } = require('../../../ports/out');

// FASE 4 del plan del módulo horarios (completada): la validación de reservas
// consume la MISMA fuente de verdad que GET /medicos/:id/slots.
//
// Antes este adaptador leía `svc_med.horarios_base` (la tabla del módulo viejo
// de médicos) con su propia lógica: ignoraba los horarios de SEMANA específica
// y los bloqueos de agenda de `svc_hor`. Resultado: lo que /slots mostraba
// libre, la reserva lo rechazaba con COLISION_HORARIO (o aceptaba horas recién
// bloqueadas). Ahora delega en ResolverHorarioEfectivoUseCase (semana >
// plantilla) + bloqueos_agenda — una sola respuesta a "¿qué horario aplica?".
const { resolverHorarioEfectivoUseCase } = require('../../../../horarios');
const { HorariosMySQLRepository } = require('../../../../horarios/adapters/out/repositories/HorariosMySQLRepository');

class MedicoDisponibilidadDBAdapter extends IMedicoDisponibilidadPort {
  constructor() {
    super();
    this.horariosRepo = new HorariosMySQLRepository();
  }

  async obtenerDisponibilidad(idMedico, fecha) {
    try {
      const horario = await resolverHorarioEfectivoUseCase.ejecutar(idMedico, fecha);
      if (!horario) return null; // sin horario → cache no se pobla → fallback optimista

      const bloqueos = await this.horariosRepo.findBloqueosEnFecha(idMedico, fecha);

      const [hIni, mIni] = horario.horaInicio.split(':').map(Number);
      const [hFin, mFin] = horario.horaFin.split(':').map(Number);
      const duracion = horario.duracionCitaMin;

      let cur = hIni * 60 + mIni;
      const fin = hFin * 60 + mFin;
      const slots = [];

      while (cur < fin) {
        const next = cur + duracion;
        const hh    = String(Math.floor(cur / 60)).padStart(2, '0');
        const mm    = String(cur % 60).padStart(2, '0');
        const hhFin = String(Math.floor(next / 60)).padStart(2, '0');
        const mmFin = String(next % 60).padStart(2, '0');

        // Un slot que solapa un bloqueo de agenda NO es reservable (misma
        // regla que pinta 'bloqueado' en GET /slots).
        const slotIni = new Date(`${fecha}T${hh}:${mm}:00`);
        const slotFin = new Date(slotIni.getTime() + duracion * 60000);
        const bloqueado = bloqueos.some((b) => b.seSolapaCon(slotIni, slotFin));

        slots.push({
          horaInicio: `${hh}:${mm}`,
          horaFin:    `${hhFin}:${mmFin}`,
          disponible: !bloqueado,
        });

        cur = next;
      }

      return slots;
    } catch (err) {
      console.warn('[MedicoDisponibilidadDBAdapter] Error leyendo horario:', err.message);
      return null; // fallback optimista — el constraint UNIQUE en BD es la red final
    }
  }
}

module.exports = { MedicoDisponibilidadDBAdapter };
