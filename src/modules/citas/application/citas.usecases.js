const { v4: uuidv4 } = require('uuid');
const { MedicoNoDisponibleError, CitaNoEncontradaError, CitaInvalidaError } = require('../domain/cita.errors');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');
const { client: redis } = require('../../../config/redis');

class CitasUseCases {
  constructor(citasRepository) {
    this.citasRepository = citasRepository;
  }

  async checkDisponibilidadEnCache(idMedico, fechaHora) {
    const key = `medico:${idMedico}:bloqueos`;
    const bloqueos = await redis.get(key);
    if (bloqueos) {
      // Validar bloqueos si existieran
    }
    return true;
  }

  async reservarCita(citaDto, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const solapada = await this.citasRepository.existeCitaSolapada(citaDto.id_medico, citaDto.fecha_hora, conn);
      if (solapada) throw new MedicoNoDisponibleError();

      await this.checkDisponibilidadEnCache(citaDto.id_medico, citaDto.fecha_hora);

      const idCita = uuidv4();
      const nuevaCita = { 
        ...citaDto, 
        id_cita: idCita, 
        estado: 'Pendiente'
      };

      await this.citasRepository.create(nuevaCita, conn);

      await publicarEventoOutbox(conn, 'svc_cit', {
        idEvento: uuidv4(),
        tipoEvento: 'CitaReservada',
        payload: nuevaCita,
        correlationId
      });

      await conn.commit();
      return nuevaCita;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async cancelarCita(idCita, motivo, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const cita = await this.citasRepository.findById(idCita, conn);
      if (!cita) throw new CitaNoEncontradaError();
      if (cita.estado === 'Cancelada') throw new CitaInvalidaError('La cita ya está cancelada');

      await this.citasRepository.updateEstado(idCita, 'Cancelada', motivo, conn);

      await publicarEventoOutbox(conn, 'svc_cit', {
        idEvento: uuidv4(),
        tipoEvento: 'CitaCancelada',
        payload: { id_cita: idCita, id_medico: cita.id_medico, id_paciente: cita.id_paciente, motivo },
        correlationId
      });

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = CitasUseCases;
