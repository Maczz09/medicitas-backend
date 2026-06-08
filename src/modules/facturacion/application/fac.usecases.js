const { v4: uuidv4 } = require('uuid');
const { ComprobanteDuplicadoError } = require('../domain/fac.errors');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');

class FacUseCases {
  constructor(facRepository) {
    this.facRepository = facRepository;
  }

  async generarComprobante(datosFacturacion, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const existe = await this.facRepository.existeComprobantePorPago(datosFacturacion.id_pago, conn);
      if (existe) throw new ComprobanteDuplicadoError();

      const idComprobante = uuidv4();
      const numeroSerie = `${datosFacturacion.tipo_comprobante === 'FACTURA' ? 'F' : 'B'}001-${Math.floor(100000 + Math.random() * 900000)}`;
      
      const igv = datosFacturacion.monto_total * 0.18;

      const comprobante = {
        id_comprobante: idComprobante,
        id_pago: datosFacturacion.id_pago,
        id_paciente: datosFacturacion.id_paciente,
        tipo_comprobante: datosFacturacion.tipo_comprobante,
        numero_serie: numeroSerie,
        ruc_dni: datosFacturacion.ruc_dni,
        nombre_razon_social: datosFacturacion.nombre_razon_social,
        monto_total: datosFacturacion.monto_total,
        igv: igv,
        estado: 'EMITIDO'
      };

      await this.facRepository.generarComprobante(comprobante, conn);

      await publicarEventoOutbox(conn, 'svc_fac', {
        idEvento: uuidv4(),
        tipoEvento: 'ComprobanteGenerado',
        payload: comprobante,
        correlationId
      });

      await conn.commit();
      return comprobante;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = FacUseCases;
