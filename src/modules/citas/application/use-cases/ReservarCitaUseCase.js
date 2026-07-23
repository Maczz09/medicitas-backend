const { Cita } = require('../../domain/entities/Cita');
const { FechaHoraCita } = require('../../domain/value-objects/FechaHoraCita');
const { 
  ColisionHorarioError, 
  DesincronizacionCacheError, 
  PacienteNoDisponibleError,
  CitaNoEncontradaError 
} = require('../../domain/cita.errors');
// OJO: `ResourceNotFoundError` NO existe en shared/domain/errors (solo exporta
// DomainError, ValidationError, UnauthorizedError, ForbiddenError,
// NotFoundError, ConflictError) — importarlo dejaba el nombre en `undefined`
// y `new ResourceNotFoundError(...)` lanzaba un TypeError sin `.codigo` ni
// `.name` reconocibles, que el catch de abajo malinterpretaba como "Pacientes
// no disponible" (503) en vez de "paciente no existe" (404 real de negocio).
const { ValidationError, NotFoundError } = require('../../../../shared/domain/errors');
const { conReintentoAnteDeadlock } = require('../../../../shared/resilience/retryOnDeadlock');
const logger = require('../../../../shared/logger/logger');

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
        throw new NotFoundError('PACIENTE_NO_ENCONTRADO', `El paciente ${dto.idPaciente} no existe`);
      }
    } catch (err) {
      if (err.name === 'PacienteNoDisponibleError') {
        throw err;
      }
      if (err.codigo === 'PACIENTE_NO_ENCONTRADO') throw err;
      // Dependencia inalcanzable (circuito abierto, timeout) — a diferencia
      // del caso de arriba, aquí SÍ dejamos rastro en la auditoría: es el
      // único de los 4 caminos de fallo de este use case que antes no
      // registraba ningún IntentoReserva.
      await this._registrarIntentoReserva(dto, correlationId, 'FALLIDO', 'PACIENTE_SERVICIO_CAIDO', null);
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
    try {
      // Nombres para enriquecer el evento — no participan de la unicidad
      // médico+horario; leerlos ANTES de abrir la transacción acorta el
      // tiempo que se retiene el lock del INSERT bajo escritura concurrente
      // (menor ventana de contención → menos deadlocks; ver retryOnDeadlock.js).
      const [[medRow]] = await conn.query(
        `SELECT CONCAT('Dr. ', nombre, ' ', apellido) AS nombre FROM svc_med.medicos WHERE id_medico = ?`,
        [cita.idMedico]
      );
      const [[pacRow]] = await conn.query(
        `SELECT CONCAT(nombre, ' ', apellido) AS nombre, telefono FROM svc_pac.pacientes WHERE id_paciente = ?`,
        [cita.idPaciente]
      );

      // Todo el ciclo BEGIN→trabajo→COMMIT/ROLLBACK se reintenta como unidad:
      // un deadlock (1213) hace que InnoDB revierta la transacción completa,
      // así que no hay nada parcial que reanudar — hay que repetirla entera.
      await conReintentoAnteDeadlock(async () => {
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

          // Métrica de negocio (Prometheus/Grafana). El contador vivía en el use
          // case viejo citas.usecases.js (código muerto) y nunca se incrementaba
          // desde la API real → el dashboard mostraba 0. Se mueve aquí.
          try {
            const { citasCreadasCounter } = require('../../../../config/metrics');
            citasCreadasCounter.inc({ especialidad: cita.especialidad || 'General' });
          } catch { /* la métrica nunca debe romper la reserva */ }

          await this.disponibilidadCache.marcarOcupado(cita.idMedico, cita.fechaHora).catch(() => {});

        } catch (err) {
          await conn.rollback();
          throw err;
        }
      }, { nombreServicio: 'ReservarCita→MySQL' }, logger);

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
