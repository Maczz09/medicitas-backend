const { v4: uuidv4 } = require('uuid');
const { 
  PacienteNotFoundError, 
  PacienteDuplicadoError, 
  InvalidDocumentError,
  InvalidDateError,
  PaginationError
} = require('../domain/paciente.errors');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');

class PacientesUseCases {
  constructor(pacientesRepository) {
    this.pacientesRepository = pacientesRepository;
  }

  _validarDocumento(tipo_documento, numero_documento) {
    const tiposValidos = ['DNI', 'CE', 'PASAPORTE'];
    if (!tiposValidos.includes(tipo_documento)) {
      throw new InvalidDocumentError(`Tipo de documento inválido. Debe ser: ${tiposValidos.join(', ')}`);
    }

    if (tipo_documento === 'DNI' && !/^\d{8}$/.test(numero_documento)) {
      throw new InvalidDocumentError('El DNI debe tener exactamente 8 dígitos numéricos');
    }
    if (tipo_documento === 'CE' && !/^[A-Za-z0-9]{9}$/.test(numero_documento)) {
      throw new InvalidDocumentError('El Carné de Extranjería (CE) debe tener exactamente 9 caracteres');
    }
    if (tipo_documento === 'PASAPORTE' && numero_documento.length > 15) {
      throw new InvalidDocumentError('El pasaporte no puede exceder los 15 caracteres');
    }
  }

  _validarFechaNacimiento(fecha) {
    const fn = new Date(fecha);
    const hoy = new Date();
    if (isNaN(fn.getTime())) throw new InvalidDateError('Formato de fecha inválido');
    if (fn > hoy) throw new InvalidDateError('La fecha de nacimiento no puede estar en el futuro');
  }

  async createPaciente(pacienteDto, correlationId) {
    this._validarDocumento(pacienteDto.tipo_documento, pacienteDto.numero_documento);
    this._validarFechaNacimiento(pacienteDto.fecha_nacimiento);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const existing = await this.pacientesRepository.findByDocumento(pacienteDto.tipo_documento, pacienteDto.numero_documento, conn);
      if (existing) throw new PacienteDuplicadoError();

      const idPaciente = uuidv4();
      const nuevoPaciente = { ...pacienteDto, id_paciente: idPaciente };

      await this.pacientesRepository.create(nuevoPaciente, conn);

      // Patrón Outbox
      await publicarEventoOutbox(conn, 'svc_pac', {
        idEvento: uuidv4(),
        tipoEvento: 'PacienteRegistrado',
        payload: nuevoPaciente,
        correlationId
      });

      await conn.commit();
      return nuevoPaciente;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getPaciente(idPaciente) {
    const paciente = await this.pacientesRepository.findById(idPaciente);
    if (!paciente) throw new PacienteNotFoundError();
    return paciente;
  }

  async listPacientes(query, page = 1, limit = 10) {
    if (page < 1 || limit < 1 || limit > 100) {
      throw new PaginationError('Página y límite deben ser positivos. Límite máximo 100.');
    }
    const offset = (page - 1) * limit;
    
    const result = await this.pacientesRepository.searchPaginated({ query, offset, limit: parseInt(limit, 10) });
    const totalPages = Math.ceil(result.total / limit);

    return {
      data: result.data,
      meta: {
        total: result.total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages
      }
    };
  }

  async updatePaciente(idPaciente, dto, correlationId) {
    if (dto.tipo_documento && dto.numero_documento) {
      this._validarDocumento(dto.tipo_documento, dto.numero_documento);
    }
    if (dto.fecha_nacimiento) this._validarFechaNacimiento(dto.fecha_nacimiento);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const existing = await this.pacientesRepository.findByIdAny(idPaciente, conn);
      if (!existing) throw new PacienteNotFoundError();

      await this.pacientesRepository.update(idPaciente, dto, conn);

      await publicarEventoOutbox(conn, 'svc_pac', {
        idEvento: uuidv4(),
        tipoEvento: 'PacienteActualizado',
        payload: { id_paciente: idPaciente, ...dto },
        correlationId,
      });

      await conn.commit();
      return this.pacientesRepository.findByIdAny(idPaciente);
    } catch (err) {
      await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') throw new PacienteDuplicadoError();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateContacto(idPaciente, { telefono, email, direccion }, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const paciente = await this.pacientesRepository.findById(idPaciente, conn);
      if (!paciente) throw new PacienteNotFoundError();

      await this.pacientesRepository.updateContact(idPaciente, { telefono, email, direccion }, conn);

      await publicarEventoOutbox(conn, 'svc_pac', {
        idEvento: uuidv4(),
        tipoEvento: 'DatosContactoActualizados',
        payload: { id_paciente: idPaciente, telefono, email, direccion },
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

  async toggleEstado(idPaciente, activo, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Buscamos sin el filtro de activo = 1 para poder reactivar
      const [rows] = await conn.query(`SELECT * FROM svc_pac.pacientes WHERE id_paciente = ?`, [idPaciente]);
      if (rows.length === 0) throw new PacienteNotFoundError();

      await this.pacientesRepository.updateEstado(idPaciente, activo ? 1 : 0, conn);

      await publicarEventoOutbox(conn, 'svc_pac', {
        idEvento: uuidv4(),
        tipoEvento: 'EstadoPacienteActualizado',
        payload: { id_paciente: idPaciente, activo },
        correlationId
      });

      await conn.commit();
      return { id_paciente: idPaciente, activo: activo ? 1 : 0 };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = PacientesUseCases;
