const { v4: uuidv4 } = require('uuid');
const { PagoRechazadoError, PagoDuplicadoError } = require('../domain/pagos.errors');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');

class PagosUseCases {
  constructor(pagosRepository, pasarelaService) {
    this.pagosRepository = pagosRepository;
    this.pasarelaService = pasarelaService;
  }

  async procesarPago(datosPago, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const yaPagado = await this.pagosRepository.existePagoParaCita(datosPago.id_cita, conn);
      if (yaPagado) throw new PagoDuplicadoError();

      const montoCobertura = (datosPago.monto_total * datosPago.porcentaje_cobertura) / 100;
      const montoCopago = datosPago.monto_total - montoCobertura;

      let codigoAutorizacion = null;
      let estadoPago = 'PROCESADO';

      if (montoCopago > 0 && datosPago.metodo_pago !== 'EFECTIVO' && datosPago.metodo_pago !== 'SEGURO') {
        const respuestaPasarela = await this.pasarelaService.procesarCargo(datosPago.tarjeta, montoCopago);
        if (!respuestaPasarela.aprobado) {
          throw new PagoRechazadoError(respuestaPasarela.motivo);
        }
        codigoAutorizacion = respuestaPasarela.codigoAutorizacion;
      } else if (datosPago.metodo_pago === 'EFECTIVO' || datosPago.metodo_pago === 'SEGURO') {
        codigoAutorizacion = `CASH-${Date.now()}`;
      }

      const idPago = uuidv4();
      const pago = {
        id_pago: idPago,
        id_cita: datosPago.id_cita,
        id_paciente: datosPago.id_paciente,
        codigo_autorizacion: codigoAutorizacion,
        metodo_pago: datosPago.metodo_pago,
        monto_total: datosPago.monto_total,
        monto_cobertura: montoCobertura,
        monto_copago: montoCopago,
        estado: estadoPago,
        tipo_comprobante: datosPago.tipo_comprobante || 'BOLETA'
      };

      await this.pagosRepository.guardarPago(pago, conn);

      await publicarEventoOutbox(conn, 'svc_pag', {
        idEvento: uuidv4(),
        tipoEvento: 'PagoConfirmado',
        payload: {
          id_pago: idPago,
          id_cita: pago.id_cita,
          estado: pago.estado,
          monto_pagado: pago.monto_copago
        },
        correlationId
      });
      
      const { pagosCompletadosCounter, pagosMontoTotal } = require('../../../config/metrics');
      pagosCompletadosCounter.inc({ metodo_pago: datosPago.metodo_pago });
      pagosMontoTotal.inc({ metodo_pago: datosPago.metodo_pago }, datosPago.monto_total);

      await conn.commit();
      return pago;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = PagosUseCases;
