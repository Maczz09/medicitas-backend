const Despacho = require('../../domain/entities/Despacho');

class DespachosMySQLRepository {
  async save(despacho, conn) {
    const query = `
      INSERT INTO svc_pre.despachos (
        id, id_evento_origen, id_prescripcion_clinica, id_encuentro_clinico, id_paciente,
        id_farmacia, estado, contenido, fecha_emision, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      despacho.id,
      despacho.idEventoOrigen,
      despacho.idPrescripcionClinica,
      despacho.idEncuentroClinico,
      despacho.idPaciente,
      despacho.idFarmacia,
      despacho.estado,
      despacho.contenido ? JSON.stringify(despacho.contenido) : null,
      despacho.fechaEmision,
      despacho.correlationId
    ];
    await conn.query(query, params);
  }

  async findById(id, dbOrConn) {
    const [rows] = await dbOrConn.query('SELECT * FROM svc_pre.despachos WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    return this._mapToDomain(rows[0]);
  }

  async findByIdEventoOrigen(idEventoOrigen, dbOrConn) {
    const [rows] = await dbOrConn.query('SELECT * FROM svc_pre.despachos WHERE id_evento_origen = ?', [idEventoOrigen]);
    if (rows.length === 0) return null;
    return this._mapToDomain(rows[0]);
  }

  async actualizarEstado(despacho, conn) {
    const query = `
      UPDATE svc_pre.despachos 
      SET estado = ?, 
          intentos_envio = ?, 
          fecha_despacho = ?, 
          fecha_retiro = ?, 
          referencia_farmacia = ?, 
          observacion_farmacia = ?, 
          motivo_rechazo = ?
      WHERE id = ?
    `;
    const params = [
      despacho.estado,
      despacho.intentosEnvio,
      despacho.fechaDespacho,
      despacho.fechaRetiro,
      despacho.referenciaFarmacia,
      despacho.observacionFarmacia,
      despacho.motivoRechazo,
      despacho.id
    ];
    await conn.query(query, params);
  }

  _mapToDomain(row) {
    return new Despacho({
      id: row.id,
      idEventoOrigen: row.id_evento_origen,
      idPrescripcionClinica: row.id_prescripcion_clinica,
      idEncuentroClinico: row.id_encuentro_clinico,
      idPaciente: row.id_paciente,
      idFarmacia: row.id_farmacia,
      estado: row.estado,
      contenido: typeof row.contenido === 'string' ? JSON.parse(row.contenido) : row.contenido,
      fechaEmision: row.fecha_emision,
      fechaDespacho: row.fecha_despacho,
      fechaRetiro: row.fecha_retiro,
      referenciaFarmacia: row.referencia_farmacia,
      observacionFarmacia: row.observacion_farmacia,
      motivoRechazo: row.motivo_rechazo,
      intentosEnvio: row.intentos_envio,
      correlationId: row.correlation_id
    });
  }
}

module.exports = DespachosMySQLRepository;
