const db = require('../../../config/database');

class MySQLPagosRepository {
  async existePagoParaCita(idCita, conn = db) {
    const [rows] = await conn.query(
      `SELECT 1 FROM svc_pag.pagos WHERE id_cita = ? AND estado IN ('PROCESADO', 'PENDIENTE')`,
      [idCita]
    );
    return rows.length > 0;
  }

  async guardarPago(pago, conn = db) {
    await conn.query(
      `INSERT INTO svc_pag.pagos 
       (id_pago, id_cita, id_paciente, codigo_autorizacion, metodo_pago, monto_total, monto_cobertura, monto_copago, estado, tipo_comprobante)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pago.id_pago, pago.id_cita, pago.id_paciente, pago.codigo_autorizacion,
        pago.metodo_pago, pago.monto_total, pago.monto_cobertura, pago.monto_copago,
        pago.estado, pago.tipo_comprobante
      ]
    );
  }
}

module.exports = MySQLPagosRepository;
