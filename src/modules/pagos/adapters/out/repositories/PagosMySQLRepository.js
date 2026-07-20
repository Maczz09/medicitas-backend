const { Pago } = require('../../../domain/entities/Pago');
const { DomainError } = require('../../../../../shared/domain/errors');

// Columnas reales de svc_pag.pagos:
//   id_pago, id_cita, id_paciente, codigo_autorizacion, id_validacion_cobertura,
//   metodo_pago, monto_total, monto_cobertura, cobertura_verificada,
//   monto_copago, estado, tipo_comprobante, numero_comprobante,
//   created_at, updated_at
// (observaciones/correlationId del dominio siguen sin persistirse — no se
//  usan fuera del ciclo de vida de la propia request.)
class PagosMySQLRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findById(id) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id_pago, id_cita, id_paciente, codigo_autorizacion,
                id_validacion_cobertura, metodo_pago, monto_total, monto_cobertura,
                cobertura_verificada, monto_copago, tipo_comprobante,
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
        `SELECT id_pago, id_cita, id_paciente, codigo_autorizacion,
                id_validacion_cobertura, metodo_pago, monto_total, monto_cobertura,
                cobertura_verificada, monto_copago, tipo_comprobante,
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
         (id_pago, id_cita, id_paciente, codigo_autorizacion, id_validacion_cobertura,
          metodo_pago, monto_total, monto_cobertura, cobertura_verificada,
          monto_copago, tipo_comprobante, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pago.id, pago.idCita, pago.idPaciente, pago.codigoAutorizacionSeguro,
          pago.idValidacionCobertura, pago.metodoPago, pago.montoTotal,
          pago.montoCubiertoSeguro, pago.coberturaVerificada ? 1 : 0,
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

  // Pagos confirmados con Coberturas inalcanzable en su momento — candidatos a
  // reconciliar cuando Coberturas se recupera. Newest-first (mismo criterio
  // que Seguros, misma razón: el pago recién hecho, con el auditor mirando la
  // pantalla, se beneficia más de una corrección instantánea que uno viejo).
  async findPendientesVerificacion(limit) {
    const conn = await this.pool.getConnection();
    try {
      const limiteSeguro = Number.isInteger(Number(limit)) ? Number(limit) : 20;
      const [rows] = await conn.execute(
        `SELECT id_pago, id_validacion_cobertura, codigo_autorizacion
         FROM svc_pag.pagos
         WHERE cobertura_verificada = 0
         ORDER BY created_at DESC
         LIMIT ${limiteSeguro}`
      );
      return rows.map((r) => ({
        idPago: r.id_pago,
        idValidacionCobertura: r.id_validacion_cobertura,
        codigoAutorizacionSeguro: r.codigo_autorizacion,
      }));
    } finally {
      conn.release();
    }
  }

  // Recibe conexión de la TX del caller (mismo criterio que save()). Devuelve
  // affectedRows para que el caller detecte si otro worker del clúster ya
  // reconcilió esta fila antes y evite publicar un evento duplicado.
  async marcarCoberturaVerificada(idPago, connection) {
    const [result] = await connection.execute(
      `UPDATE svc_pag.pagos SET cobertura_verificada = 1
       WHERE id_pago = ? AND cobertura_verificada = 0`,
      [idPago]
    );
    return result.affectedRows;
  }

  _mapear(r) {
    return new Pago({
      id:                       r.id_pago,
      idCita:                   r.id_cita,
      idPaciente:               r.id_paciente,
      idValidacionCobertura:    r.id_validacion_cobertura,
      codigoAutorizacionSeguro: r.codigo_autorizacion,
      coberturaVerificada:      r.cobertura_verificada === 1,
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
