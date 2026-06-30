const { DomainError } = require('../../../../shared/domain/errors');
const { DiagnosticoCIE10 } = require('../../domain/value-objects/DiagnosticoCIE10');
const { PrescripcionClinica } = require('../../domain/value-objects/PrescripcionClinica');
const { v4: uuidv4 } = require('uuid');

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

      // Best-effort: mover la cita a Completada. El encuentro ya está guardado.
      this.citaValidator.completarCita(dto.idCita).catch((err) => {
        console.warn(`[HCL] No se pudo completar cita ${dto.idCita}: ${err.message}`);
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
}

module.exports = { RegistrarConsultaUseCase };
