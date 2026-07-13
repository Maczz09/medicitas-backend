const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarRecetasContingenciaUseCase {
  constructor({ recetasContingenciaRepository, db }) {
    this.recetasRepo = recetasContingenciaRepository;
    this.db = db;
  }

  async listar({ page, limit }) {
    return this.recetasRepo.findAll({ page, limit }, this.db);
  }

  // Devuelve la receta con los datos enriquecidos (paciente, encuentro,
  // referencia de farmacia) para que la ruta de descarga regenere el PDF al
  // vuelo en memoria (ya no se lee de disco).
  async obtenerParaPdf(id) {
    const receta = await this.recetasRepo.findParaPdf(id, this.db);
    if (!receta) {
      throw new DomainError('RECETA_CONTINGENCIA_NO_ENCONTRADA', 404,
        `No existe receta de contingencia con id ${id}.`);
    }
    return receta;
  }

  /** Detalle completo de un despacho para la vista de auditoría/médico: hora, médico (CMP), cita, farmacia. */
  async obtenerDetalle(idDespacho) {
    const row = await this.recetasRepo.findDetalleByIdDespacho(idDespacho, this.db);
    if (!row) {
      throw new DomainError('RECETA_NO_ENCONTRADA', 404, `No existe receta con id ${idDespacho}.`);
    }

    return {
      idReceta: row.id,
      estado: row.estado,
      contenido: typeof row.contenido === 'string' ? JSON.parse(row.contenido) : row.contenido,
      fechaEmision: row.fecha_emision,
      fechaDespacho: row.fecha_despacho,
      fechaRetiro: row.fecha_retiro,
      referenciaFarmacia: row.referencia_farmacia,
      observacionFarmacia: row.observacion_farmacia,
      motivoRechazo: row.motivo_rechazo,
      intentosEnvio: row.intentos_envio,
      correlationId: row.despacho_correlation_id,
      farmacia: { id: row.id_farmacia },
      paciente: {
        id: row.id_paciente,
        nombre: row.paciente_nombre,
        tipoDocumento: row.paciente_tipo_documento,
        numeroDocumento: row.paciente_numero_documento,
        telefono: row.paciente_telefono,
      },
      medico: row.id_medico ? {
        id: row.id_medico,
        nombre: row.medico_nombre,
        cmp: row.medico_cmp,
        especialidad: row.medico_especialidad,
      } : null,
      cita: row.id_cita ? {
        id: row.id_cita,
        fechaHora: row.cita_fecha_hora,
        especialidad: row.cita_especialidad,
        estado: row.cita_estado,
      } : null,
      encuentro: row.id_encuentro_clinico ? {
        id: row.id_encuentro_clinico,
        fechaHora: row.encuentro_fecha_hora,
        diagnosticoCie10: row.diagnostico_cie10,
        diagnosticoDescripcion: row.diagnostico_descripcion,
      } : null,
      recetaPDF: row.id_receta_pdf ? {
        id: row.id_receta_pdf,
        esContingencia: !!row.es_contingencia,
        urlDescarga: row.url_descarga,
        generadaEn: row.receta_pdf_generada_en,
      } : null,
    };
  }
}

module.exports = ConsultarRecetasContingenciaUseCase;
