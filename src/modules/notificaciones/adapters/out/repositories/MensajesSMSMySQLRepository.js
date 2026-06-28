const { MensajeSMS } = require('../../../domain/entities/MensajeSMS');
const { DomainError } = require('../../../../../shared/domain/errors');

// Mapeo entidad → columnas reales de svc_not.mensajes_sms
class MensajesSMSMySQLRepository {
  constructor(pool) { this.pool = pool; }

  async findByIdEvento(idEvento) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id_mensaje, id_evento_origen, tipo_evento, id_paciente,
                telefono_destino, contenido, estado, referencia_gateway,
                error_msg, intentos, correlation_id, created_at, enviado_en
         FROM svc_not.mensajes_sms WHERE id_evento_origen = ?`,
        [idEvento]
      );
      return rows.length === 0 ? null : this._mapear(rows[0]);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al consultar mensaje SMS');
    } finally {
      conn.release();
    }
  }

  async save(mensajeSMS, connection) {
    try {
      await connection.execute(
        `INSERT INTO svc_not.mensajes_sms
         (id_mensaje, id_evento_origen, tipo_evento, id_paciente,
          telefono_destino, contenido, estado, referencia_gateway,
          error_msg, intentos, correlation_id, enviado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mensajeSMS.id,
          mensajeSMS.idEvento,
          mensajeSMS.tipoEvento,
          mensajeSMS.idPaciente    || null,
          mensajeSMS.telefono,
          mensajeSMS.mensaje,
          mensajeSMS.estado,
          mensajeSMS.referenciaGateway || null,
          mensajeSMS.errorDetalle  || null,
          mensajeSMS.intentos      || 1,
          mensajeSMS.correlationId || null,
          mensajeSMS.sentAt        || null,
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return;
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al guardar mensaje SMS');
    }
  }

  async findByIdPaciente(idPaciente, { pagina = 1, porPagina = 20 } = {}) {
    const conn = await this.pool.getConnection();
    try {
      const offset = (pagina - 1) * porPagina;
      const [rows] = await conn.execute(
        `SELECT id_mensaje, id_evento_origen, tipo_evento, id_paciente,
                telefono_destino, contenido, estado, referencia_gateway,
                correlation_id, created_at, enviado_en
         FROM svc_not.mensajes_sms
         WHERE id_paciente = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [idPaciente, porPagina, offset]
      );
      return rows.map(this._mapear);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al listar SMS del paciente');
    } finally {
      conn.release();
    }
  }

  _mapear(r) {
    return new MensajeSMS({
      id:                r.id_mensaje,
      idEvento:          r.id_evento_origen,
      tipoEvento:        r.tipo_evento,
      idPaciente:        r.id_paciente,
      telefono:          r.telefono_destino,
      mensaje:           r.contenido,
      estado:            r.estado,
      referenciaGateway: r.referencia_gateway,
      errorDetalle:      r.error_msg,
      intentos:          r.intentos,
      correlationId:     r.correlation_id,
      sentAt:            r.enviado_en,
      createdAt:         r.created_at,
    });
  }
}

module.exports = { MensajesSMSMySQLRepository };
