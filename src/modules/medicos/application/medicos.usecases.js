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
