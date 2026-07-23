const { DomainError } = require('../../../../shared/domain/errors');
const { DiagnosticoCIE10 } = require('../../domain/value-objects/DiagnosticoCIE10');
const { PrescripcionClinica } = require('../../domain/value-objects/PrescripcionClinica');
const { v4: uuidv4 } = require('uuid');
const logger = require('../../../../shared/logger/logger');

class RegistrarConsultaUseCase {
  constructor({ expedienteRepository, encuentroRepository, citaValidator, eventPublisher, getConnection }) {
    this.expedienteRepository = expedienteRepository;
    this.encuentroRepository  = encuentroRepository;
    this.citaValidator        = citaValidator;
    this.eventPublisher       = eventPublisher;
    this.getConnection        = getConnection;
  }

  async ejecutar(dto, correlationId) {
    let diagnostico;
    try {
      diagnostico = new DiagnosticoCIE10(dto.diagnosticoCie10);
    } catch {
      throw new DomainError('DIAGNOSTICO_CIE10_INVALIDO', `Formato CIE-10 inválido: ${dto.diagnosticoCie10}`, 400);
    }

    const prescripciones = [];
    try {
      for (const p of (dto.prescripciones || [])) {
        prescripciones.push(new PrescripcionClinica(p));
      }
    } catch (err) {
      throw new DomainError('DATOS_INVALIDOS', err.message, 400);
    }

    const estadoCita = await this.citaValidator.obtenerEstadoCita(dto.idCita);
    if (!estadoCita) {
      throw new DomainError('CITA_NO_ENCONTRADA', `Cita ${dto.idCita} no existe`, 404);
    }
    if (estadoCita.estado !== 'EnCurso' && estadoCita.estado !== 'En_Atencion') {
      throw new DomainError('CITA_NO_EN_ATENCION', `La cita ${dto.idCita} debe estar en curso`, 409);
    }

    // Autorización a nivel de recurso: un Médico solo puede registrar
    // encuentros de SUS propias citas (no de las de otro médico). El Auditor
    // queda exento (supervisión). Sin esta validación, cualquier médico
    // autenticado podía escribir en el expediente clínico de citas ajenas.
    const rol = String(dto.rolUsuario || '').toUpperCase();
    const esMedico = rol === 'MÉDICO' || rol === 'MEDICO';
    if (esMedico && estadoCita.idMedico && estadoCita.idMedico !== dto.idMedico) {
      throw new DomainError(
        'CITA_DE_OTRO_MEDICO',
        403,
        'No puedes registrar encuentros clínicos de citas asignadas a otro médico.'
      );
    }

    const expediente = await this.expedienteRepository.findByIdPaciente(dto.idPaciente);
    if (!expediente) {
      throw new DomainError('EXPEDIENTE_NO_ENCONTRADO', `No existe expediente para ${dto.idPaciente}`, 404);
    }

    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      const idEncuentro = `ENC-${Date.now()}`;
      await this.encuentroRepository.save({
        id: idEncuentro,
        idExpediente: expediente.id,
        idCita: dto.idCita,
        idMedico: dto.idMedico,
        diagnosticoCie10: diagnostico.toString(),
        descripcion: dto.descripcion || null,
        fechaEncuentro: new Date(),
      }, conn);

      const idsPrescripciones = [];
      for (const presc of prescripciones) {
        const idPresc = `PRESC-${uuidv4().slice(0, 8).toUpperCase()}`;
        await this.encuentroRepository.savePrescripcion({
          id: idPresc,
          idEncuentro,
          idMedico: dto.idMedico,
          idPaciente: dto.idPaciente,
          contenido: presc,
        }, conn);
        idsPrescripciones.push(idPresc);
      }

      await this.eventPublisher.publish(conn, 'EncuentroClinicoRegistrado', {
        idEncuentro,
        idExpediente: expediente.id,
        idPaciente: dto.idPaciente,
        idMedico: dto.idMedico,
        idCita: dto.idCita,
        diagnosticoCie10: diagnostico.toString(),
        fechaEncuentro: new Date().toISOString(),
      }, correlationId);

      for (let i = 0; i < prescripciones.length; i++) {
        await this.eventPublisher.publish(conn, 'PrescripcionEmitida', {
          idPrescripcionClinica: idsPrescripciones[i],
          idEncuentro,
          idPaciente: dto.idPaciente,
          idMedico: dto.idMedico,
          contenido: prescripciones[i],
        }, correlationId);
      }

      await this.eventPublisher.publish(conn, 'AccesoExpediente', {
        idExpediente: expediente.id,
        idPaciente: dto.idPaciente,
        idUsuario: dto.idUsuario,
        rolUsuario: dto.rolUsuario,
        accion: 'REGISTRO_ENCUENTRO',
        timestamp: new Date().toISOString(),
      }, correlationId);

      await conn.commit();

      // Métrica de negocio (Prometheus/Grafana): encuentros clínicos registrados.
      try {
        const { encuentrosHclCounter } = require('../../../../config/metrics');
        encuentrosHclCounter.inc();
      } catch { /* la métrica nunca debe romper el registro */ }

      // Best-effort: mover la cita a Completada. El encuentro ya está
      // guardado (correcto, nunca se pierde) — esto es un efecto secundario
      // no crítico, así que no bloquea la respuesta al médico.
      this.citaValidator.completarCita(dto.idCita).catch(async (err) => {
        if (err.codigo === 'CITA_TRANSICION_INVALIDA') {
          // Citas ya rechazó esta transición (409, p. ej. la cancelaron
          // mientras tanto) — no es reconciliable con un reintento, es un
          // hecho de negocio definitivo. Se alerta, nunca se marca pendiente.
          logger.warn({ idCita: dto.idCita, idEncuentro, err: err.message }, '[HCL] Citas rechazó completar la cita — no se reintentará');
          await this._publicarInconsistencia(idEncuentro, dto.idCita, err.message, correlationId);
          return;
        }
        // Dependencia inalcanzable (timeout, circuito abierto) — se persiste
        // pendiente para que el recovery-replay de historiaClinica.routes.js
        // la reconcilie en cuanto Citas se recupere.
        logger.warn({ idCita: dto.idCita, idEncuentro, err: err.message }, '[HCL] No se pudo completar la cita — queda pendiente de reconciliar');
        try {
          await this.encuentroRepository.marcarCitaPendienteReconciliar(idEncuentro);
        } catch (e) {
          logger.error({ err: e, idEncuentro }, '[HCL] No se pudo marcar el encuentro como pendiente de reconciliar');
        }
      });

      return {
        idEncuentro,
        idExpediente: expediente.id,
        estado: 'REGISTRADO',
        prescripcionesGeneradas: prescripciones.length,
        mensaje: `Encuentro registrado. ${prescripciones.length} prescripción(es) encoladas para despacho.`,
        correlationId,
      };

    } catch (err) {
      await conn.rollback();
      if (err instanceof DomainError) throw err;
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al registrar encuentro clínico', 500);
    } finally {
      conn.release();
    }
  }

  // Se llama SOLO desde el .catch() post-commit de completarCita() cuando
  // Citas rechazó la transición con 409 — nunca marca el encuentro como
  // pendiente (no hay nada que reintentar), solo deja constancia para
  // revisión humana. Abre su propia conexión/TX (fuera de la TX principal,
  // ya liberada).
  async _publicarInconsistencia(idEncuentro, idCita, motivo, correlationId) {
    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.eventPublisher.publish(conn, 'CitaCompletadaInconsistente', {
        idEncuentro, idCita, motivo,
      }, correlationId);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      logger.error({ err, idEncuentro, idCita }, '[HCL] No se pudo registrar la inconsistencia de completar cita');
    } finally {
      conn.release();
    }
  }
}

module.exports = { RegistrarConsultaUseCase };
