const { Pago } = require('../../../domain/entities/Pago');
const { DomainError } = require('../../../../../shared/domain/errors');

class PagosMySQLRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, id_cita, id_paciente, id_validacion_cobertura,
                codigo_autorizacion_seguro, metodo_pago, monto_total,
                monto_cubierto_seguro, monto_copago, tipo_comprobante,
                estado, observaciones, correlation_id, created_at
         FROM svc_pag.pagos WHERE id = ?`,
        [id]
      );
      if (rows.length === 0) return null;
      return this._mapear(rows[0]);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al consultar el pago');
    } finally {
      conn.release();
    }
  }

  async findByIdCita(idCita) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, id_cita, id_paciente, id_validacion_cobertura,
                codigo_autorizacion_seguro, metodo_pago, monto_total,
                monto_cubierto_seguro, monto_copago, tipo_comprobante,
                estado, observaciones, correlation_id, created_at
         FROM svc_pag.pagos WHERE id_cita = ?`,
        [idCita]
      );
      if (rows.length === 0) return null;
      return this._mapear(rows[0]);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al consultar el pago por cita');
    } finally {
      conn.release();
    }
  }

  async save(pago, connection) {
    try {
      await connection.execute(
        `INSERT INTO svc_pag.pagos
         (id, id_cita, id_paciente, id_validacion_cobertura,
          codigo_autorizacion_seguro, metodo_pago, monto_total,
          monto_cubierto_seguro, monto_copago, tipo_comprobante,
          estado, observaciones, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pago.id, pago.idCita, pago.idPaciente, pago.idValidacionCobertura,
          pago.codigoAutorizacionSeguro, pago.metodoPago, pago.montoTotal,
          pago.montoCubiertoSeguro, pago.montoCopago, pago.tipoComprobante,
          pago.estado, pago.observaciones, pago.correlationId,
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new DomainError('PAGO_DUPLICADO', 409,
          `La cita ${pago.idCita} ya tiene un pago registrado`);
      }
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al guardar el pago');
    }
  }

  async update(pago, connection) {
    try {
      await connection.execute(
        `UPDATE svc_pag.pagos
         SET estado = ?, observaciones = ?, updated_at = NOW()
         WHERE id = ?`,
        [pago.estado, pago.observaciones, pago.id]
      );
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al actualizar el pago');
    }
  }

  _mapear(r) {
    return new Pago({
      id:                       r.id,
      idCita:                   r.id_cita,
      idPaciente:               r.id_paciente,
      idValidacionCobertura:    r.id_validacion_cobertura,
      codigoAutorizacionSeguro: r.codigo_autorizacion_seguro,
      metodoPago:               r.metodo_pago,
      montoTotal:               parseFloat(r.monto_total),
      montoCubiertoSeguro:      parseFloat(r.monto_cubierto_seguro),
      montoCopago:              parseFloat(r.monto_copago),
      tipoComprobante:          r.tipo_comprobante,
      estado:                   r.estado,
      observaciones:            r.observaciones,
      correlationId:            r.correlation_id,
    });
  }
}

module.exports = { PagosMySQLRepository };
