const { v4: uuidv4 } = require('uuid');
const { MedicoNotFoundError, MedicoDuplicadoError } = require('../domain/medico.errors');
const db = require('../../../config/database');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const asyncContext = require('../../../shared/logger/asyncContext');

class MedicosUseCases {
  constructor(medicosRepository) {
    this.medicosRepository = medicosRepository;
  }

  _correlationId() {
    return asyncContext.getStore()?.get('correlationId') || uuidv4();
  }

  async _emit(tipoEvento, payload) {
    const conn = await db.getConnection();
    try {
      await publicarEventoOutbox(conn, 'svc_med', {
        idEvento: uuidv4(),
        tipoEvento,
        payload,
        correlationId: this._correlationId(),
      });
    } finally {
      conn.release();
    }
  }

  async createMedico(medicoDto) {
    const existing = await this.medicosRepository.findByCmp(medicoDto.cmp);
    if (existing) throw new MedicoDuplicadoError();

    const idMedico = uuidv4();
    const nuevoMedico = { ...medicoDto, id_medico: idMedico };

    await this.medicosRepository.create(nuevoMedico);
    await this._emit('MedicoCreado', nuevoMedico)
      .catch((err) => console.warn('[Médicos] Error publicando MedicoCreado:', err.message));
    return nuevoMedico;
  }

  async listMedicos() {
    return this.medicosRepository.findAll();
  }

  async getMedico(idMedico) {
    const medico = await this.medicosRepository.findByIdAny(idMedico);
    if (!medico) throw new MedicoNotFoundError();
    return medico;
  }

  async updateMedico(idMedico, dto) {
    const medico = await this.medicosRepository.findByIdAny(idMedico);
    if (!medico) throw new MedicoNotFoundError();

    if (dto.cmp && dto.cmp !== medico.cmp) {
      const existente = await this.medicosRepository.findByCmp(dto.cmp);
      if (existente) throw new MedicoDuplicadoError();
    }

    await this.medicosRepository.update(idMedico, {
      nombre: dto.nombre,
      apellido: dto.apellido,
      cmp: dto.cmp,
      especialidad: dto.especialidad,
      activo: dto.activo,
    });
    const updated = await this.medicosRepository.findByIdAny(idMedico);
    await this._emit('MedicoActualizado', updated)
      .catch((err) => console.warn('[Médicos] Error publicando MedicoActualizado:', err.message));
    return updated;
  }

  async getDisponibilidadBase(idMedico) {
    const medico = await this.medicosRepository.findById(idMedico);
    if (!medico) throw new MedicoNotFoundError();

    const horarios = await this.medicosRepository.getHorarios(idMedico);
    const bloqueos = await this.medicosRepository.getBloqueos(idMedico);

    return { medico, horarios, bloqueos };
  }

  async registrarHorarios(idMedico, horarios) {
    const medico = await this.medicosRepository.findById(idMedico);
    if (!medico) throw new MedicoNotFoundError();

    await this.medicosRepository.saveHorarios(idMedico, horarios);
    await this._emit('HorariosActualizados', { idMedico, horarios })
      .catch((err) => console.warn('[Médicos] Error publicando HorariosActualizados:', err.message));
  }

  async getSlotsForDate(idMedico, fecha) {
    const medico = await this.medicosRepository.findById(idMedico);
    if (!medico) throw new MedicoNotFoundError();

    // dia_semana: 0=Domingo, 1=Lunes … 6=Sábado (igual que JS Date.getDay())
    const fechaDate = new Date(`${fecha}T00:00:00`);
    const diaSemana = fechaDate.getDay();

    // 1. Horario del médico para ese día
    const [horarios] = await db.query(
      `SELECT hora_inicio, hora_fin, duracion_cita_min
       FROM svc_med.horarios_base
       WHERE id_medico = ? AND dia_semana = ? AND activo = 1
       LIMIT 1`,
      [idMedico, diaSemana]
    );
    const horario = horarios[0] || null;

    // 2. Bloqueos que se solapan con el día completo
    const [bloqueos] = await db.query(
      `SELECT id_bloqueo, fecha_inicio, fecha_fin, motivo
       FROM svc_med.bloqueos_agenda
       WHERE id_medico = ?
         AND fecha_inicio < ? AND fecha_fin > ?`,
      [idMedico, `${fecha} 23:59:59`, `${fecha} 00:00:00`]
    );

    // 3. Citas activas del médico en esa fecha
    const [citas] = await db.query(
      `SELECT c.id AS id_cita, DATE_FORMAT(c.fecha_hora, '%H:%i') AS hora,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre
       FROM svc_cit.citas c
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = c.id_paciente
       WHERE c.id_medico = ?
         AND DATE(c.fecha_hora) = ?
         AND c.estado NOT IN ('Cancelada','No_Asistida')`,
      [idMedico, fecha]
    );
    const citasPorHora = {};
    for (const c of citas) citasPorHora[c.hora] = c;

    // 4. Generar slots
    const slots = [];
    if (horario) {
      const [hIni, mIni] = horario.hora_inicio.split(':').map(Number);
      const [hFin, mFin] = horario.hora_fin.split(':').map(Number);
      const duracion = horario.duracion_cita_min;

      let cur = hIni * 60 + mIni;
      const fin = hFin * 60 + mFin;

      while (cur < fin) {
        const hh = String(Math.floor(cur / 60)).padStart(2, '0');
        const mm = String(cur % 60).padStart(2, '0');
        const horaStr = `${hh}:${mm}`;
        const fechaHoraISO = `${fecha}T${horaStr}:00`;
        const slotDt = new Date(fechaHoraISO);
        const slotFin = new Date(slotDt.getTime() + duracion * 60000);

        // Determinar estado
        let estado = 'libre';
        let motivoBloqueo = null;

        const bloqueado = bloqueos.find(
          (b) => new Date(b.fecha_inicio) < slotFin && new Date(b.fecha_fin) > slotDt
        );
        if (bloqueado) {
          estado = 'bloqueado';
          motivoBloqueo = bloqueado.motivo || 'Bloqueo';
        } else if (citasPorHora[horaStr]) {
          estado = 'ocupado';
        }

        slots.push({ hora: horaStr, fechaHora: fechaHoraISO, estado, motivoBloqueo,
          paciente: estado === 'ocupado' ? citasPorHora[horaStr].paciente_nombre : null });

        cur += duracion;
      }
    }

    return { fecha, diaSemana, tieneHorario: !!horario, horario, bloqueos, slots };
  }

  async registrarBloqueo(idMedico, bloqueoDto) {
    const medico = await this.medicosRepository.findById(idMedico);
    if (!medico) throw new MedicoNotFoundError();

    const idBloqueo = uuidv4();
    await this.medicosRepository.saveBloqueo({ ...bloqueoDto, id_medico: idMedico, id_bloqueo: idBloqueo });
    await this._emit('BloqueoRegistrado', { idMedico, idBloqueo, ...bloqueoDto })
      .catch((err) => console.warn('[Médicos] Error publicando BloqueoRegistrado:', err.message));
    return { id_bloqueo: idBloqueo };
  }
}

module.exports = MedicosUseCases;
