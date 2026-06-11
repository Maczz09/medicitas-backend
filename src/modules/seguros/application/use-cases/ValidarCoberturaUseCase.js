const { DomainError }   = require('../../../../shared/domain/errors');
const { Cobertura }     = require('../../domain/entities/Cobertura');
const { TipoConsulta }  = require('../../domain/value-objects/TipoConsulta');
const logger = require('../../../../shared/logger/logger');

class ValidarCoberturaUseCase {
  /**
   * @param {ICoberturaRepository}   coberturaRepository
   * @param {IAseguradoraGateway}    aseguradoraGateway   — Mock o Real, el UC no sabe cuál
   * @param {IPacienteValidatorPort} pacienteValidator
   * @param {IEventPublisher}        eventPublisher
   * @param {Function}               getConnection
   */
  constructor({ coberturaRepository, aseguradoraGateway, pacienteValidator,
                eventPublisher, getConnection }) {
    this.coberturaRepo     = coberturaRepository;
    this.gateway           = aseguradoraGateway;
    this.pacienteValidator = pacienteValidator;
    this.eventPublisher    = eventPublisher;
    this.getConnection     = getConnection;
  }

  async ejecutar(dto, correlationId) {
    // ── 1. Validar campos obligatorios ────────────────────────────────────────
    const { idPaciente, idAseguradora, numeroPoliza, tipoConsulta } = dto;
    if (!idPaciente || !idAseguradora || !numeroPoliza || !tipoConsulta) {
      throw new DomainError('DATOS_INVALIDOS', 400,
        'idPaciente, idAseguradora, numeroPoliza y tipoConsulta son obligatorios');
    }

    // ── 2. Validar value object TipoConsulta (falla rápido) ───────────────────
    let tipoConsultaVO;
    try {
      tipoConsultaVO = new TipoConsulta(tipoConsulta);
    } catch (err) {
      throw err; // Ya es DomainError con código correcto
    }

    // ── 3. Validar que el paciente existe (SVC-PAC-005) ───────────────────
    const existePaciente = await this.pacienteValidator.existePaciente(idPaciente);
    if (!existePaciente) {
      throw new DomainError('PACIENTE_NO_ENCONTRADO', 404,
        `El paciente ${idPaciente} no existe`);
    }

    // ── 4. Llamar al gateway (Mock o Real — transparente para el use case) ────
    // El Circuit Breaker ya está dentro del adaptador real.
    // Si el CB está abierto, el gateway devuelve esFallback: true con PENDIENTE.
    // NUNCA lanza error por estado de cobertura — eso es lógica de negocio, no error.
    let respuestaGateway;
    try {
      respuestaGateway = await this.gateway.validarPoliza({
        idPaciente, idAseguradora, numeroPoliza,
        tipoConsulta: tipoConsultaVO.toString(),
      });
    } catch (err) {
      // Error inesperado del adaptador (no del CB — eso ya tiene fallback)
      logger.error({ err, correlationId }, 'Error al llamar al gateway de aseguradora');
      throw new DomainError('ERROR_ADAPTADOR_EXTERNO', 500,
        'Error interno al comunicarse con la aseguradora');
    }

    // ── 5. Crear entidad de dominio con el resultado sanitizado ───────────────
    const cobertura = Cobertura.crear({
      idPaciente,
      idAseguradora,
      numeroPoliza,
      tipoConsulta:        tipoConsultaVO.toString(),
      estadoCobertura:     respuestaGateway.estadoCobertura,
      porcentajeCobertura: respuestaGateway.porcentajeCobertura,
      codigoAutorizacion:  respuestaGateway.codigoAutorizacion,
      vigencia:            respuestaGateway.vigencia,
      esFallback:          respuestaGateway.esFallback,
      correlationId,
    });

    // ── 6. Persistir resultado + publicar evento (misma transacción) ──────────
    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      await this.coberturaRepo.save(cobertura, conn);

      await this.eventPublisher.publish(conn, cobertura.eventoAPublicar(), {
        idValidacion:        cobertura.id,
        idPaciente:          cobertura.idPaciente,
        idAseguradora:       cobertura.idAseguradora,
        numeroPoliza:        cobertura.numeroPoliza,
        estadoCobertura:     cobertura.estadoCobertura,
        porcentajeCobertura: cobertura.porcentajeCobertura,
        codigoAutorizacion:  cobertura.codigoAutorizacion,
        vigencia:            cobertura.vigencia,
        esFallback:          cobertura.esFallback,
      }, correlationId);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      logger.error({ err, correlationId }, 'Error al persistir resultado de cobertura');
      throw new DomainError('ERROR_INTERNO_SEG', 500, 'Error al guardar resultado de validación');
    } finally {
      conn.release();
    }

    // ── 7. Retornar DTO ───────────────────────────────────────────────────────
    const dto_respuesta = {
      idValidacion:        cobertura.id,
      estadoCobertura:     cobertura.estadoCobertura,
      porcentajeCobertura: cobertura.porcentajeCobertura,
      codigoAutorizacion:  cobertura.codigoAutorizacion,
      vigencia:            cobertura.vigencia,
      esFallback:          cobertura.esFallback,
      correlationId,
    };

    // Agregar mensaje explicativo solo cuando es estado de contingencia
    if (cobertura.estaPendiente()) {
      dto_respuesta.mensaje =
        'La aseguradora no está disponible. La cobertura queda pendiente. El cobro puede realizarse manualmente.';
    }

    return dto_respuesta;
  }
}

module.exports = { ValidarCoberturaUseCase };
