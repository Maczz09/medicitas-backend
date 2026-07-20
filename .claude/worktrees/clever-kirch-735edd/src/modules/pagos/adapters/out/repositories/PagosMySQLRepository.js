const { Pago } = require('../../../domain/entities/Pago');
const { DomainError } = require('../../../../../shared/domain/errors');

// Columnas reales de svc_pag.pagos:
//   id_pago, id_cita, id_paciente, codigo_autorizacion, metodo_pago,
//   monto_total, monto_cobertura, monto_copago, estado, tipo_comprobante,
//   numero_comprobante, created_at, updated_at
// (la tabla no tiene id_validacion_cobertura, observaciones ni correlation_id;
//  esos campos del dominio no se persisten.)
class PagosMySQLRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id_pago, id_cita, id_paciente, codigo_autorizacion, metodo_pago,
                monto_total, monto_cobertura, monto_copago, tipo_comprobante,
                estado, numero_comprobante, created_at
         FROM svc_pag.pagos WHERE id_pago = ?`,
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
        `SELECT id_pago, id_cita, id_paciente, codigo_autorizacion, metodo_pago,
                monto_total, monto_cobertura, monto_copago, tipo_comprobante,
                estado, numero_comprobante, created_at
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
         (id_pago, id_cita, id_paciente, codigo_autorizacion, metodo_pago,
          monto_total, monto_cobertura, monto_copago, tipo_comprobante, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pago.id, pago.idCita, pago.idPaciente, pago.codigoAutorizacionSeguro,
          pago.metodoPago, pago.montoTotal, pago.montoCubiertoSeguro,
          pago.montoCopago, pago.tipoComprobante, pago.estado,
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
        `UPDATE svc_pag.pagos SET estado = ?, updated_at = NOW() WHERE id_pago = ?`,
        [pago.estado, pago.id]
      );
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al actualizar el pago');
    }
  }

  _mapear(r) {
    return new Pago({
      id:                       r.id_pago,
      idCita:                   r.id_cita,
      idPaciente:               r.id_paciente,
      idValidacionCobertura:    null,
      codigoAutorizacionSeguro: r.codigo_autorizacion,
      metodoPago:               r.metodo_pago,
      montoTotal:               parseFloat(r.monto_total),
      montoCubiertoSeguro:      parseFloat(r.monto_cobertura),
      montoCopago:              parseFloat(r.monto_copago),
      tipoComprobante:          r.tipo_comprobante,
      estado:                   r.estado,
      observaciones:            null,
      correlationId:            null,
    });
  }
}

module.exports = { PagosMySQLRepository };
