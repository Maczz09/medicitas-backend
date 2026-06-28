const { Cita } = require('../../domain/entities/Cita');
const { FechaHoraCita } = require('../../domain/value-objects/FechaHoraCita');
const { 
  ColisionHorarioError, 
  DesincronizacionCacheError, 
  PacienteNoDisponibleError,
  CitaNoEncontradaError 
} = require('../../domain/cita.errors');
const { ValidationError, ResourceNotFoundError } = require('../../../../shared/domain/errors');

class ReservarCitaUseCase {
  constructor({
    citasRepository,
    disponibilidadCache,
    pacienteValidator,
    eventPublisher,
    getConnection,
  }) {
    this.citasRepo = citasRepository;
    this.disponibilidadCache = disponibilidadCache;
    this.pacienteValidator = pacienteValidator;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
  }

  async ejecutar(dto, correlationId) {
    if (!dto.idPaciente || !dto.idMedico || !dto.especialidad) {
      throw new ValidationError('idPaciente, idMedico y especialidad son obligatorios', 'DATOS_INVALIDOS');
    }

    let fechaHoraVO;
    try {
      fechaHoraVO = new FechaHoraCita(dto.fechaHora);
    } catch (err) {
      throw err;
    }

    try {
      const existePaciente = await this.pacienteValidator.existePaciente(dto.idPaciente);
      if (!existePaciente) {
        await this._registrarIntentoReserva(dto, correlationId, 'FALLIDO', 'PACIENTE_NO_ENCONTRADO', null);
        throw new ResourceNotFoundError(`El paciente ${dto.idPaciente} no existe`, 'PACIENTE_NO_ENCONTRADO');
      }
    } catch (err) {
      if (err.name === 'PacienteNoDisponibleError') {
        throw err;
      }
      if (err.codigo === 'PACIENTE_NO_ENCONTRADO') throw err;
      throw new PacienteNoDisponibleError();
    }

    const disponible = await this.disponibilidadCache.verificarDisponibilidad(
      dto.idMedico, fechaHoraVO.toDate()
    );
    if (!disponible) {
      await this._registrarIntentoReserva(dto, correlationId, 'FALLIDO', 'COLISION_HORARIO', null);
      throw new ColisionHorarioError(`El médico ${dto.idMedico} no tiene disponibilidad en ${fechaHoraVO.toISOString()}`);
    }

    const cita = Cita.crear({
      idPaciente: dto.idPaciente,
      idMedico: dto.idMedico,
      fechaHora: fechaHoraVO.toDate(),
      especialidad: dto.especialidad,
      correlationId,
    });

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      // Locking row to avoid race condition
      const [colision] = await conn.execute(
        `SELECT id FROM svc_cit.citas
         WHERE id_medico = ? AND fecha_hora = ?
           AND estado NOT IN ('Cancelada', 'No_Asistida')
         FOR UPDATE`,
        [cita.idMedico, cita.fechaHora]
      );
      if (colision.length > 0) {
        await conn.rollback();
        await this._registrarIntentoReserva(dto, correlationId, 'FALLIDO', 'DESINCRONIZACION_CACHE', null);
        throw new DesincronizacionCacheError('El slot fue reservado por otro proceso. La caché de disponibilidad se actualizará automáticamente.');
      }

      await this.citasRepo.save(cita, conn);

      // Enriquecer el evento con nombres para el WhatsApp de confirmación
      const [[medRow]] = await conn.query(
        `SELECT CONCAT('Dr. ', nombre, ' ', apellido) AS nombre FROM svc_med.medicos WHERE id_medico = ?`,
        [cita.idMedico]
      );
      const [[pacRow]] = await conn.query(
        `SELECT CONCAT(nombre, ' ', apellido) AS nombre, telefono FROM svc_pac.pacientes WHERE id_paciente = ?`,
        [cita.idPaciente]
      );

      await this.eventPublisher.publish(conn, 'CitaCreada', {
        idCita:            cita.id,
        idPaciente:        cita.idPaciente,
        idMedico:          cita.idMedico,
        fechaHora:         cita.fechaHora.toISOString(),
        especialidad:      cita.especialidad,
        pacienteNombre:    pacRow?.nombre ?? null,
        medicoNombre:      medRow?.nombre ?? null,
        pacienteTelefono:  pacRow?.telefono ?? null,
      }, correlationId);

      await conn.commit();

      await this.disponibilidadCache.marcarOcupado(cita.idMedico, cita.fechaHora).catch(() => {});

    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await this._registrarIntentoReserva(dto, correlationId, 'EXITOSO', null, cita.id);

    return {
      idCita: cita.id,
      estado: cita.estado,
      idPaciente: cita.idPaciente,
      idMedico: cita.idMedico,
      fechaHora: cita.fechaHora.toISOString(),
      especialidad: cita.especialidad,
      mensaje: 'Cita reservada. Recordatorio SMS encolado.',
      correlationId,
    };
  }

  async _registrarIntentoReserva(dto, correlationId, resultado, codigoError, idCita) {
    try {
      await this.eventPublisher.publishIndependiente('IntentoReserva', {
        idPaciente: dto.idPaciente,
        idMedico: dto.idMedico,
        fechaHora: dto.fechaHora,
        especialidad: dto.especialidad,
        resultado,
        codigoError: codigoError || null,
        idCita: idCita || null,
      }, correlationId);
    } catch {
      // Tolerante a fallos
    }
  }
}

module.exports = { ReservarCitaUseCase };
