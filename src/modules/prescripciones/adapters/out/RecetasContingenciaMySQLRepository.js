class RecetasContingenciaMySQLRepository {
  async findByIdDespacho(idDespacho, dbOrConn) {
    const [rows] = await dbOrConn.query(
      'SELECT * FROM svc_pre.recetas_contingencia WHERE id_despacho = ?', [idDespacho]
    );
    if (rows.length === 0) return null;
    return this._mapToDTO(rows[0]);
  }

  async findById(id, dbOrConn) {
    const [rows] = await dbOrConn.query(
      'SELECT * FROM svc_pre.recetas_contingencia WHERE id = ?', [id]
    );
    if (rows.length === 0) return null;
    return this._mapToDTO(rows[0]);
  }

  // Para la ruta de descarga, que regenera el PDF al vuelo (ya no se lee de
  // disco): además de la receta trae los datos que el PDF imprime pero que no
  // se persisten en recetas_contingencia — nombre del paciente, encuentro
  // clínico y referencia de farmacia (viven en svc_pac.pacientes y despachos).
  async findParaPdf(id, db) {
    const [rows] = await db.query(
      `SELECT rc.*,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
              d.id_encuentro_clinico, d.referencia_farmacia
       FROM svc_pre.recetas_contingencia rc
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = rc.id_paciente
       LEFT JOIN svc_pre.despachos d ON d.id = rc.id_despacho
       WHERE rc.id = ?`,
      [id]
    );
    if (rows.length === 0) return null;
    return {
      ...this._mapToDTO(rows[0]),
      nombrePaciente:     rows[0].paciente_nombre,
      idEncuentroClinico: rows[0].id_encuentro_clinico,
      referenciaFarmacia: rows[0].referencia_farmacia,
    };
  }

  async save(receta, conn) {
    const query = `
      INSERT INTO svc_pre.recetas_contingencia (
        id, id_despacho, id_paciente, medicamento, dosis, cantidad,
        es_contingencia, ruta_pdf, url_descarga, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      receta.id, receta.idDespacho, receta.idPaciente,
      receta.medicamento || null, receta.dosis || null, receta.cantidad || null,
      receta.esContingencia ? 1 : 0,
      receta.rutaPdf, receta.urlDescarga, receta.correlationId || null,
    ];
    await conn.query(query, params);
  }

  async findAll({ page, limit }, db) {
    const offset = (page - 1) * limit;
    const [countRows] = await db.query('SELECT COUNT(*) AS total FROM svc_pre.recetas_contingencia');
    const [rows] = await db.query(
      `SELECT rc.id, rc.id_despacho, rc.id_paciente, rc.medicamento, rc.dosis, rc.cantidad,
              rc.es_contingencia, rc.url_descarga, rc.correlation_id, rc.created_at,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
              d.estado AS estado_despacho
       FROM svc_pre.recetas_contingencia rc
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = rc.id_paciente
       LEFT JOIN svc_pre.despachos d ON d.id = rc.id_despacho
       ORDER BY rc.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`
    );
    return {
      data: rows,
      total: countRows[0].total,
    };
  }

  /** Detalle completo para la vista de auditoría/médico: médico (con CMP), cita y farmacia. */
  async findDetalleByIdDespacho(idDespacho, db) {
    const [rows] = await db.query(
      `SELECT d.id, d.estado, d.contenido, d.fecha_emision, d.fecha_despacho, d.fecha_retiro,
              d.referencia_farmacia, d.observacion_farmacia, d.motivo_rechazo, d.intentos_envio,
              d.correlation_id AS despacho_correlation_id, d.id_farmacia, d.id_paciente, d.id_encuentro_clinico,
              CONCAT(p.nombre, ' ', p.apellido) AS paciente_nombre,
              p.tipo_documento AS paciente_tipo_documento, p.numero_documento AS paciente_numero_documento,
              p.telefono AS paciente_telefono,
              ec.id_cita, ec.fecha_hora AS encuentro_fecha_hora,
              ec.diagnostico_cie10, ec.diagnostico_descripcion,
              m.id_medico, CONCAT(m.nombre, ' ', m.apellido) AS medico_nombre,
              m.cmp AS medico_cmp, m.especialidad AS medico_especialidad,
              c.fecha_hora AS cita_fecha_hora, c.especialidad AS cita_especialidad, c.estado AS cita_estado,
              rc.id AS id_receta_pdf, rc.es_contingencia, rc.url_descarga, rc.created_at AS receta_pdf_generada_en
       FROM svc_pre.despachos d
       LEFT JOIN svc_pac.pacientes p ON p.id_paciente = d.id_paciente
       LEFT JOIN svc_hcl.encuentros_clinicos ec ON ec.id_encuentro = d.id_encuentro_clinico
       LEFT JOIN svc_med.medicos m ON m.id_medico = ec.id_medico
       LEFT JOIN svc_cit.citas c ON c.id = ec.id_cita
       LEFT JOIN svc_pre.recetas_contingencia rc ON rc.id_despacho = d.id
       WHERE d.id = ?`,
      [idDespacho]
    );
    return rows[0] || null;
  }

  // Enriquecimiento same-DB (no HTTP) — mismo patrón ya usado por el listado
  // de despachos en prescripciones.routes.js (LEFT JOIN directo a svc_pac).
  async obtenerNombrePaciente(idPaciente, db) {
    const [rows] = await db.query(
      'SELECT nombre, apellido FROM svc_pac.pacientes WHERE id_paciente = ?', [idPaciente]
    );
    if (rows.length === 0) return null;
    return `${rows[0].nombre} ${rows[0].apellido}`;
  }

  _mapToDTO(row) {
    return {
      id: row.id,
      idDespacho: row.id_despacho,
      idPaciente: row.id_paciente,
      esContingencia: !!row.es_contingencia,
      medicamento: row.medicamento,
      dosis: row.dosis,
      cantidad: row.cantidad,
      rutaPdf: row.ruta_pdf,
      urlDescarga: row.url_descarga,
      correlationId: row.correlation_id,
      fechaGeneracion: row.created_at,
    };
  }
}

module.exports = RecetasContingenciaMySQLRepository;
