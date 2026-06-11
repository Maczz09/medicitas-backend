const { Cobertura }  = require('../../../domain/entities/Cobertura');
const { DomainError } = require('../../../../../shared/domain/errors');

class CoberturasMySQLRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // Recibe conexión activa de la TX — no abre conexión propia
  async save(cobertura, connection) {
    try {
      await connection.execute(
        `INSERT INTO svc_seg.validaciones_cobertura
         (id, id_paciente, id_aseguradora, numero_poliza, tipo_consulta,
          estado_cobertura, porcentaje_cobertura, codigo_autorizacion,
          vigencia, es_fallback, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cobertura.id, cobertura.idPaciente, cobertura.idAseguradora,
          cobertura.numeroPoliza, cobertura.tipoConsulta,
          cobertura.estadoCobertura, cobertura.porcentajeCobertura,
          cobertura.codigoAutorizacion, cobertura.vigencia,
          cobertura.esFallback ? 1 : 0, cobertura.correlationId,
        ]
      );
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_SEG', 500, 'Error al guardar la cobertura');
    }
  }

  async findById(id) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, id_paciente, id_aseguradora, numero_poliza, tipo_consulta,
                estado_cobertura, porcentaje_cobertura, codigo_autorizacion,
                vigencia, es_fallback, correlation_id, created_at
         FROM svc_seg.validaciones_cobertura WHERE id = ?`,
        [id]
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return new Cobertura({
        id:                  r.id,
        idPaciente:          r.id_paciente,
        idAseguradora:       r.id_aseguradora,
        numeroPoliza:        r.numero_poliza,
        tipoConsulta:        r.tipo_consulta,
        estadoCobertura:     r.estado_cobertura,
        porcentajeCobertura: parseFloat(r.porcentaje_cobertura),
        codigoAutorizacion:  r.codigo_autorizacion,
        vigencia:            r.vigencia ? r.vigencia.toISOString().split('T')[0] : null,
        esFallback:          r.es_fallback === 1,
        correlationId:       r.correlation_id,
      });
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_SEG', 500, 'Error al consultar la cobertura');
    } finally {
      conn.release();
    }
  }
}

module.exports = { CoberturasMySQLRepository };
