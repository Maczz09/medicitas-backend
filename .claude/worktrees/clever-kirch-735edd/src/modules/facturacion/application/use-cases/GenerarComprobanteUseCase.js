const { DomainError }       = require('../../../../shared/domain/errors');
const { Comprobante }       = require('../../domain/entities/Comprobante');
const { NumeroComprobante } = require('../../domain/value-objects/NumeroComprobante');
const logger = require('../../../../shared/logger/logger');

class GenerarComprobanteUseCase {
  constructor({
    comprobantesRepository, seriesRepository,
    pdfGenerator, pacienteDatos,
    eventPublisher, getConnection,
  }) {
    this.comprobantesRepo = comprobantesRepository;
    this.seriesRepo       = seriesRepository;
    this.pdfGenerator     = pdfGenerator;
    this.pacienteDatos    = pacienteDatos;
    this.eventPublisher   = eventPublisher;
    this.getConnection    = getConnection;
  }

  async ejecutar(payload, correlationId) {
    const {
      idPago, idCita, idPaciente, metodoPago,
      montoTotal, montoCubiertoSeguro, montoCopago,
      tieneCobertura, tipoComprobante,
    } = payload;

    const existente = await this.comprobantesRepo.findByIdPago(idPago);

    if (existente?.estaEmitido()) {
      logger.info({ idPago, idComprobante: existente.id },
        'Comprobante ya emitido — omitiendo (idempotencia)');
      return; 
    }

    if (existente?.estaPendiente()) {
      logger.warn({ idPago }, 'Comprobante en PENDIENTE — posible procesamiento concurrente');
      return; 
    }

    const esReintento = existente?.estaEnError();

    const conn = await this.getConnection();
    await conn.beginTransaction();

    let comprobante;
    try {
      if (esReintento) {
        existente.estado               = 'PENDIENTE';
        existente.errorMensaje         = null;
        existente.intentosGeneracion  += 1;
        comprobante = existente;
        await this.comprobantesRepo.update(comprobante, conn);
      } else {
        const ultimoNumero = await this.seriesRepo.siguienteNumero(tipoComprobante, conn);
        const numero       = NumeroComprobante.formatear(tipoComprobante, ultimoNumero);
        
        comprobante = Comprobante.crear({
          idPago, idPaciente, idCita, tipo: tipoComprobante, numero,
          montoTotal, montoCubiertoSeguro, montoCopago,
          metodoPago, tieneCobertura, correlationId,
        });
        await this.comprobantesRepo.save(comprobante, conn);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      logger.error({ err, idPago }, 'Error en TX1 al reservar número de comprobante');
      throw err; 
    } finally {
      conn.release();
    }

    let nombrePaciente = null;
    try {
      nombrePaciente = await this.pacienteDatos.obtenerNombre(idPaciente);
    } catch (err) {
      logger.warn({ idPaciente }, 'No se pudo obtener nombre del paciente. Usando ID como fallback.');
    }

    let rutaPdf, urlDescarga;
    try {
      const resultado = await this.pdfGenerator.generar({
        ...comprobante,
        nombrePaciente,
      });
      rutaPdf      = resultado.rutaPdf;
      urlDescarga  = resultado.urlDescarga;
    } catch (err) {
      logger.error({ err, idPago, idComprobante: comprobante.id }, 'Error al generar PDF');
      await this._marcarError(comprobante, `Error al generar PDF: ${err.message}`);
      throw err; 
    }

    comprobante.marcarEmitido(rutaPdf, urlDescarga, nombrePaciente);

    const conn2 = await this.getConnection();
    await conn2.beginTransaction();

    try {
      await this.comprobantesRepo.update(comprobante, conn2);

      await this.eventPublisher.publish(conn2, 'ComprobanteEmitido', {
        idComprobante: comprobante.id,
        idPago:        comprobante.idPago,
        idPaciente:    comprobante.idPaciente,
        idCita:        comprobante.idCita,
        tipo:          comprobante.tipo,
        numero:        comprobante.numero,
        montoTotal:    comprobante.montoTotal,
        montoCopago:   comprobante.montoCopago,
        urlDescarga:   comprobante.urlDescarga,
      }, correlationId);

      await conn2.commit();

      logger.info(
        { idComprobante: comprobante.id, numero: comprobante.numero, idPago },
        'Comprobante emitido correctamente'
      );
    } catch (err) {
      await conn2.rollback();
      logger.error({ err, idComprobante: comprobante.id }, 'Error en TX2 al marcar comprobante emitido');
      await this._marcarError(comprobante, `Error al persistir estado EMITIDO: ${err.message}`);
      throw err;
    } finally {
      conn2.release();
    }
  }

  async _marcarError(comprobante, mensaje) {
    comprobante.marcarError(mensaje);
    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.comprobantesRepo.update(comprobante, conn);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      logger.error({ err }, 'Error crítico: no se pudo marcar el comprobante como ERROR');
    } finally {
      conn.release();
    }
  }
}

module.exports = { GenerarComprobanteUseCase };
