const db = require('../../../config/database');

class MySQLSegurosRepository {
  async guardarValidacion(validacion, conn = db) {
    await conn.query(
      `INSERT INTO svc_seg.validaciones_cobertura 
       (id_validacion, id_paciente, id_aseguradora, numero_poliza, tipo_consulta, estado_cobertura, porcentaje_cobertura, codigo_autorizacion, respuesta_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validacion.id_validacion, validacion.id_paciente, validacion.id_aseguradora, 
        validacion.numero_poliza, validacion.tipo_consulta, validacion.estado_cobertura, 
        validacion.porcentaje_cobertura, validacion.codigo_autorizacion, JSON.stringify(validacion.respuesta_raw)
      ]
    );
  }
}

module.exports = MySQLSegurosRepository;
