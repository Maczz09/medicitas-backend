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
    let nombreVerificado = true; // false solo si Pacientes estaba inalcanzable (no un 404 limpio)
    try {
      nombrePaciente = await this.pacienteDatos.obtenerNombre(idPaciente);
    } catch (err) {
      // Fail-safe: el comprobante se emite igual (el nombre es puramente
      // cosmético para el PDF, no participa en ningún cálculo de negocio) —
      // se persiste nombreVerificado=false para que el recovery-replay
      // (server.js) lo reconcilie en cuanto Pacientes se recupere.
      nombreVerificado = false;
      logger.warn({ idPaciente, err: err.message }, 'Pacientes no disponible al generar el comprobante — se emite sin nombre, queda pendiente de reconciliar');
    }

    // El PDF ya NO se escribe a disco: se valida que se puede generar (en
    // memoria) y se guarda solo la urlDescarga. La ruta de descarga regenera el
    // PDF al vuelo desde el registro. rutaPdf queda null (columna conservada por
    // compatibilidad histórica).
    let urlDescarga;
    try {
      const resultado = await this.pdfGenerator.generar({
        ...comprobante,
        nombrePaciente,
      });
      urlDescarga = resultado.urlDescarga;
    } catch (err) {
      logger.error({ err, idPago, idComprobante: comprobante.id }, 'Error al generar PDF');
      await this._marcarError(comprobante, `Error al generar PDF: ${err.message}`);
      throw err;
    }

    comprobante.marcarEmitido(null, urlDescarga, nombrePaciente, nombreVerificado);

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

      // Métrica de negocio (Prometheus/Grafana): comprobantes emitidos. Vivía en
      // el use case viejo fac.usecases.js (no cableado al consumer real).
      try {
        const { comprobantesEmitidosCounter } = require('../../../../config/metrics');
        comprobantesEmitidosCounter.inc();
      } catch { /* la métrica nunca debe romper la emisión */ }

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
