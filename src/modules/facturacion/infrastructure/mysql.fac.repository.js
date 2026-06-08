const db = require('../../../config/database');

class MySQLFacRepository {
  async existeComprobantePorPago(idPago, conn = db) {
    const [rows] = await conn.query(
      `SELECT 1 FROM svc_fac.comprobantes WHERE id_pago = ?`,
      [idPago]
    );
    return rows.length > 0;
  }

  async generarComprobante(comprobante, conn = db) {
    await conn.query(
      `INSERT INTO svc_fac.comprobantes 
       (id_comprobante, id_pago, id_paciente, tipo_comprobante, numero_serie, ruc_dni, nombre_razon_social, monto_total, igv, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        comprobante.id_comprobante, comprobante.id_pago, comprobante.id_paciente,
        comprobante.tipo_comprobante, comprobante.numero_serie, comprobante.ruc_dni,
        comprobante.nombre_razon_social, comprobante.monto_total, comprobante.igv,
        comprobante.estado
      ]
    );
  }
}

module.exports = MySQLFacRepository;
