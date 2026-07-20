const { Comprobante } = require('../../../domain/entities/Comprobante');
const { DomainError } = require('../../../../../shared/domain/errors');

class ComprobantesMySQLRepository {
  constructor(pool) { this.pool = pool; }

  async findById(id) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, id_pago, id_paciente, id_cita, tipo, numero,
                monto_total, monto_cubierto_seguro, monto_copago,
                metodo_pago, tiene_cobertura, estado, ruta_pdf,
                url_descarga, nombre_paciente, error_mensaje,
                intentos_generacion, correlation_id, created_at
         FROM svc_fac.comprobantes WHERE id = ?`,
        [id]
      );
      return rows.length === 0 ? null : this._mapear(rows[0]);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_FAC', 500, 'Error al consultar el comprobante');
    } finally {
      conn.release();
    }
  }

  async findByIdPago(idPago) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id, id_pago, id_paciente, id_cita, tipo, numero,
                monto_total, monto_cubierto_seguro, monto_copago,
                metodo_pago, tiene_cobertura, estado, ruta_pdf,
                url_descarga, nombre_paciente, error_mensaje,
                intentos_generacion, correlation_id, created_at
         FROM svc_fac.comprobantes WHERE id_pago = ?`,
        [idPago]
      );
      return rows.length === 0 ? null : this._mapear(rows[0]);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_FAC', 500, 'Error al consultar comprobante por pago');
    } finally {
      conn.release();
    }
  }

  async save(comprobante, connection) {
    try {
      await connection.execute(
        `INSERT INTO svc_fac.comprobantes
         (id, id_pago, id_paciente, id_cita, tipo, numero,
          monto_total, monto_cubierto_seguro, monto_copago,
          metodo_pago, tiene_cobertura, estado,
          ruta_pdf, url_descarga, nombre_paciente,
          error_mensaje, intentos_generacion, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          comprobante.id, comprobante.idPago, comprobante.idPaciente, comprobante.idCita,
          comprobante.tipo, comprobante.numero, comprobante.montoTotal,
          comprobante.montoCubiertoSeguro, comprobante.montoCopago,
          comprobante.metodoPago, comprobante.tieneCobertura ? 1 : 0,
          comprobante.estado, comprobante.rutaPdf, comprobante.urlDescarga,
          comprobante.nombrePaciente, comprobante.errorMensaje,
          comprobante.intentosGeneracion, comprobante.correlationId,
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new DomainError('COMPROBANTE_DUPLICADO', 409,
          `Ya existe un comprobante para el pago ${comprobante.idPago}`);
      }
      throw new DomainError('ERROR_INTERNO_FAC', 500, 'Error al guardar el comprobante');
    }
  }

  async update(comprobante, connection) {
    try {
      await connection.execute(
        `UPDATE svc_fac.comprobantes
         SET estado = ?, ruta_pdf = ?, url_descarga = ?, nombre_paciente = ?,
             error_mensaje = ?, intentos_generacion = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          comprobante.estado, comprobante.rutaPdf, comprobante.urlDescarga,
          comprobante.nombrePaciente, comprobante.errorMensaje,
          comprobante.intentosGeneracion, comprobante.id,
        ]
      );
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_FAC', 500, 'Error al actualizar el comprobante');
    }
  }

  _mapear(r) {
    return new Comprobante({
      id:                   r.id,
      idPago:               r.id_pago,
      idPaciente:           r.id_paciente,
      idCita:               r.id_cita,
      tipo:                 r.tipo,
      numero:               r.numero,
      montoTotal:           parseFloat(r.monto_total),
      montoCubiertoSeguro:  parseFloat(r.monto_cubierto_seguro),
      montoCopago:          parseFloat(r.monto_copago),
      metodoPago:           r.metodo_pago,
      tieneCobertura:       r.tiene_cobertura === 1,
      estado:               r.estado,
      rutaPdf:              r.ruta_pdf,
      urlDescarga:          r.url_descarga,
      nombrePaciente:       r.nombre_paciente,
      errorMensaje:         r.error_mensaje,
      intentosGeneracion:   r.intentos_generacion,
      correlationId:        r.correlation_id,
    });
  }
}

module.exports = { ComprobantesMySQLRepository };
