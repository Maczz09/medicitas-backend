const { MensajeSMS } = require('../../../domain/entities/MensajeSMS');
const { DomainError } = require('../../../../../shared/domain/errors');

class MensajesSMSMySQLRepository {
  constructor(pool) { this.pool = pool; }

  async findByIdEvento(idEvento) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, id_evento, tipo_evento, id_paciente, telefono, mensaje,
                estado, referencia_gateway, error_detalle, intentos,
                correlation_id, created_at, sent_at
         FROM svc_not.mensajes_sms WHERE id_evento = ?`,
        [idEvento]
      );
      return rows.length === 0 ? null : this._mapear(rows[0]);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al consultar mensaje SMS');
    } finally {
      conn.release();
    }
  }

  // Recibe conexión activa de TX
  async save(mensajeSMS, connection) {
    try {
      await connection.execute(
        `INSERT INTO svc_not.mensajes_sms
         (id, id_evento, tipo_evento, id_paciente, telefono, mensaje,
          estado, referencia_gateway, error_detalle, intentos,
          correlation_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mensajeSMS.id, mensajeSMS.idEvento, mensajeSMS.tipoEvento,
          mensajeSMS.idPaciente, mensajeSMS.telefono, mensajeSMS.mensaje,
          mensajeSMS.estado, mensajeSMS.referenciaGateway, mensajeSMS.errorDetalle,
          mensajeSMS.intentos, mensajeSMS.correlationId, mensajeSMS.sentAt,
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Idempotencia a nivel de BD — el use case ya debería haber capturado esto antes
        return;
      }
      throw new DomainError('ERROR_INTERNO_NOT', 500, 'Error al guardar mensaje SMS');
    }
  }

  async findByIdPaciente(idPaciente, { pagina = 1, porPagina = 20 } = {}) {
    const conn = await this.pool.getConnection();
    try {
      const offset = (pagina - 1) * porPagina;
      const [rows] = await conn.execute(
        `SELECT id, id_evento, tipo_evento, id_paciente, telefono, mensaje,
                estado, referencia_gateway, correlation_id, created_at, sent_at
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
      id:                r.id,
      idEvento:          r.id_evento,
      tipoEvento:        r.tipo_evento,
      idPaciente:        r.id_paciente,
      telefono:          r.telefono,
      mensaje:           r.mensaje,
      estado:            r.estado,
      referenciaGateway: r.referencia_gateway,
      errorDetalle:      r.error_detalle,
      intentos:          r.intentos,
      correlationId:     r.correlation_id,
      sentAt:            r.sent_at,
      createdAt:         r.created_at,
    });
  }
}

module.exports = { MensajesSMSMySQLRepository };
