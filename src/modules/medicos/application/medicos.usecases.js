const { v4: uuidv4 } = require('uuid');
const { MedicoNotFoundError, MedicoDuplicadoError } = require('../domain/medico.errors');
const db = require('../../../config/database');

class MedicosUseCases {
  constructor(medicosRepository) {
    this.medicosRepository = medicosRepository;
  }

  async createMedico(medicoDto) {
    const existing = await this.medicosRepository.findByCmp(medicoDto.cmp);
    if (existing) throw new MedicoDuplicadoError();

    const idMedico = uuidv4();
    const nuevoMedico = { ...medicoDto, id_medico: idMedico };

    await this.medicosRepository.create(nuevoMedico);
    return nuevoMedico;
  }

  async listMedicos() {
    return this.medicosRepository.findAll();
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
  }

  async registrarBloqueo(idMedico, bloqueoDto) {
    const medico = await this.medicosRepository.findById(idMedico);
    if (!medico) throw new MedicoNotFoundError();

    const idBloqueo = uuidv4();
    await this.medicosRepository.saveBloqueo({ ...bloqueoDto, id_medico: idMedico, id_bloqueo: idBloqueo });
    return { id_bloqueo: idBloqueo };
  }
}

module.exports = MedicosUseCases;
