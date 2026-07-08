const { MedicoNoEncontradoError } = require('../../domain/horarios.errors');

// Migrado de medicos.usecases.js#getSlotsForDate — mismo algoritmo (camina
// minuto a minuto en pasos de duracion_cita_min desde hora_inicio hasta
// hora_fin), mismo shape de respuesta (hora_inicio/hora_fin/duracion_cita_min
// en snake_case, tal como ya lo consume SlotsResponse en el frontend) para
// no romper el contrato público de GET /medicos/:id/slots. La diferencia:
// ya no hace db.query() crudo cross-schema — usa los puertos inyectados.
class ConsultarSlotsUseCase {
  constructor({ medicoValidatorPort, resolverHorarioEfectivoUseCase, horariosRepository, ocupacionCitasPort }) {
    this.medicoValidator = medicoValidatorPort;
    this.resolverHorario = resolverHorarioEfectivoUseCase;
    this.horariosRepo = horariosRepository;
    this.ocupacionCitasPort = ocupacionCitasPort;
  }

  async ejecutar(idMedico, fecha) {
    const existe = await this.medicoValidator.existeMedicoActivo(idMedico);
    if (!existe) throw new MedicoNoEncontradoError();

    const fechaDate = new Date(`${fecha}T00:00:00`);
    const diaSemana = fechaDate.getDay();

    const horario = await this.resolverHorario.ejecutar(idMedico, fecha);
    const bloqueos = await this.horariosRepo.findBloqueosEnFecha(idMedico, fecha);
    const ocupadas = await this.ocupacionCitasPort.obtenerHorasOcupadas(idMedico, fecha);
    const ocupadasPorHora = new Map(ocupadas.map((o) => [o.hora, o]));

    const slots = [];
    if (horario) {
      const [hIni, mIni] = horario.horaInicio.split(':').map(Number);
      const [hFin, mFin] = horario.horaFin.split(':').map(Number);
      const duracion = horario.duracionCitaMin;

      let cur = hIni * 60 + mIni;
      const fin = hFin * 60 + mFin;

      while (cur < fin) {
        const hh = String(Math.floor(cur / 60)).padStart(2, '0');
        const mm = String(cur % 60).padStart(2, '0');
        const horaStr = `${hh}:${mm}`;
        const fechaHoraISO = `${fecha}T${horaStr}:00`;
        const slotDt = new Date(fechaHoraISO);
        const slotFin = new Date(slotDt.getTime() + duracion * 60000);

        let estado = 'libre';
        let motivoBloqueo = null;

        const bloqueado = bloqueos.find((b) => b.seSolapaCon(slotDt, slotFin));
        if (bloqueado) {
          estado = 'bloqueado';
          motivoBloqueo = bloqueado.motivo || 'Bloqueo';
        } else if (ocupadasPorHora.has(horaStr)) {
          estado = 'ocupado';
        }

        slots.push({
          hora: horaStr,
          fechaHora: fechaHoraISO,
          estado,
          motivoBloqueo,
          paciente: estado === 'ocupado' ? ocupadasPorHora.get(horaStr).pacienteNombre : null,
        });

        cur += duracion;
      }
    }

    return {
      fecha,
      diaSemana,
      tieneHorario: !!horario,
      horario: horario
        ? { hora_inicio: horario.horaInicio, hora_fin: horario.horaFin, duracion_cita_min: horario.duracionCitaMin }
        : null,
      // Aditivo respecto al contrato viejo — no rompe consumidores que lo ignoren.
      origenHorario: horario?.origen ?? null,
      bloqueos: bloqueos.map((b) => ({
        id_bloqueo: b.idBloqueo,
        fecha_inicio: b.fechaInicio,
        fecha_fin: b.fechaFin,
        motivo: b.motivo,
      })),
      slots,
    };
  }
}

module.exports = { ConsultarSlotsUseCase };
