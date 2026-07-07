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

  async save(receta, conn) {
    const query = `
      INSERT INTO svc_pre.recetas_contingencia (
        id, id_despacho, id_paciente, medicamento, dosis, cantidad,
        ruta_pdf, url_descarga, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      receta.id, receta.idDespacho, receta.idPaciente,
      receta.medicamento || null, receta.dosis || null, receta.cantidad || null,
      receta.rutaPdf, receta.urlDescarga, receta.correlationId || null,
    ];
    await conn.query(query, params);
  }

  async findAll({ page, limit }, db) {
    const offset = (page - 1) * limit;
    const [countRows] = await db.query('SELECT COUNT(*) AS total FROM svc_pre.recetas_contingencia');
    const [rows] = await db.query(
      `SELECT rc.id, rc.id_despacho, rc.id_paciente, rc.medicamento, rc.dosis, rc.cantidad,
              rc.url_descarga, rc.correlation_id, rc.created_at,
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
