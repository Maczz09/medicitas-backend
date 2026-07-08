// Genera el PDF de una receta y notifica al paciente por WhatsApp con el link
// de descarga — en DOS escenarios distintos, distinguidos por esContingencia:
//   true  (farmacia caída): el PDF es el único registro de la receta que el
//         paciente puede presentar mientras el despacho real se reintenta en
//         background (ver IniciarDespachoUseCase, rama TRANSPORTE).
//   false (despacho exitoso): copia de cortesía, además de que la farmacia
//         ya recibió y procesó la receta normalmente.
// Mismo caso de uso para ambos — solo cambia el contenido del PDF (el aviso
// de contingencia) y la plantilla de WhatsApp (evento distinto).
class GenerarRecetaPDFUseCase {
  constructor({ recetasContingenciaRepository, pdfGenerator, eventPublisher, getConnection, logger }) {
    this.recetasRepo    = recetasContingenciaRepository;
    this.pdfGenerator   = pdfGenerator;
    this.eventPublisher = eventPublisher;
    this.getConnection  = getConnection;
    this.logger         = logger;
  }

  async ejecutar(despacho, contenido, correlationId, { esContingencia = true, referenciaFarmacia = null } = {}) {
    // Idempotencia: un despacho solo genera un PDF una vez (UNIQUE KEY
    // uq_despacho), sin importar cuántas veces se reintente o se dispare
    // el camino de éxito y el de contingencia para el mismo despacho.
    const connCheck = await this.getConnection();
    let existente;
    try {
      existente = await this.recetasRepo.findByIdDespacho(despacho.id, connCheck);
    } finally {
      connCheck.release();
    }
    if (existente) {
      this.logger.info({ idDespacho: despacho.id }, '[RecetaPDF] Ya existe receta en PDF para este despacho — omitido.');
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
        '[RecetaPDF] No se pudo obtener el nombre del paciente — el PDF se genera solo con el ID.');
    }

    const id = `RCT-${Date.now().toString(36).toUpperCase()}`;
    const { rutaPdf, urlDescarga } = await this.pdfGenerator.generar({
      id,
      idPaciente:    despacho.idPaciente,
      nombrePaciente,
      medicamento:   contenido?.medicamento,
      dosis:         contenido?.dosis,
      cantidad:      contenido?.cantidad,
      esContingencia,
      referenciaFarmacia,
    });

    const receta = {
      id,
      idDespacho:   despacho.id,
      idPaciente:   despacho.idPaciente,
      esContingencia,
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
      // ver SMSTemplates.js: RecetaContingenciaGenerada / RecetaPDFDisponible.
      await this.eventPublisher.publish(conn, esContingencia ? 'RecetaContingenciaGenerada' : 'RecetaPDFDisponible', {
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

    this.logger.info({ idDespacho: despacho.id, idRecetaPDF: id, esContingencia },
      '[RecetaPDF] Receta en PDF generada (WhatsApp encolado).');

    return receta;
  }
}

module.exports = GenerarRecetaPDFUseCase;
