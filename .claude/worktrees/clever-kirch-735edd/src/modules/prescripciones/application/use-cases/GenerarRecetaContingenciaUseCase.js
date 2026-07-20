class GenerarRecetaContingenciaUseCase {
  constructor({ recetasContingenciaRepository, pdfGenerator, eventPublisher, getConnection, logger }) {
    this.recetasRepo    = recetasContingenciaRepository;
    this.pdfGenerator   = pdfGenerator;
    this.eventPublisher = eventPublisher;
    this.getConnection  = getConnection;
    this.logger         = logger;
  }

  async ejecutar(despacho, contenido, correlationId) {
    // Idempotencia: si el circuit breaker sigue abierto en un reintento
    // posterior del mismo despacho, no se genera un segundo PDF/WhatsApp.
    const connCheck = await this.getConnection();
    let existente;
    try {
      existente = await this.recetasRepo.findByIdDespacho(despacho.id, connCheck);
    } finally {
      connCheck.release();
    }
    if (existente) {
      this.logger.info({ idDespacho: despacho.id }, '[Contingencia] Ya existe receta de contingencia para este despacho — omitido.');
      return existente;
    }

    // Best-effort: el nombre solo mejora la legibilidad del PDF, nunca bloquea su generación.
    let nombrePaciente = null;
    try {
      const connNombre = await this.getConnection();
      try {
        nombrePaciente = await this.recetasRepo.obtenerNombrePaciente(despacho.idPaciente, connNombre);
      } finally {
        connNombre.release();
      }
    } catch (err) {
      this.logger.warn({ err: err.message, idPaciente: despacho.idPaciente },
        '[Contingencia] No se pudo obtener el nombre del paciente — el PDF se genera solo con el ID.');
    }

    const id = `RCT-${Date.now().toString(36).toUpperCase()}`;
    const { rutaPdf, urlDescarga } = await this.pdfGenerator.generar({
      id,
      idPaciente:    despacho.idPaciente,
      nombrePaciente,
      medicamento:   contenido?.medicamento,
      dosis:         contenido?.dosis,
      cantidad:      contenido?.cantidad,
    });

    const receta = {
      id,
      idDespacho:   despacho.id,
      idPaciente:   despacho.idPaciente,
      medicamento:  contenido?.medicamento,
      dosis:        contenido?.dosis,
      cantidad:     contenido?.cantidad,
      rutaPdf,
      urlDescarga,
      correlationId,
    };

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.recetasRepo.save(receta, conn);

      // Dispara el envío por WhatsApp reusando el pipeline existente de
      // notificaciones (plantilla + resolución de teléfono + retry/DLQ) —
      // ver SMSTemplates.js: RecetaContingenciaGenerada.
      await this.eventPublisher.publish(conn, 'RecetaContingenciaGenerada', {
        idPaciente:  despacho.idPaciente,
        idDespacho:  despacho.id,
        medicamento: contenido?.medicamento,
        urlDescarga,
      }, correlationId);

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    this.logger.warn({ idDespacho: despacho.id, idRecetaContingencia: id },
      '[Contingencia] Receta de contingencia generada (PDF + WhatsApp encolado).');

    return receta;
  }
}

module.exports = GenerarRecetaContingenciaUseCase;
