const { DomainError }     = require('../../../../shared/domain/errors');
const { Pago }            = require('../../domain/entities/Pago');
const { MetodoPago }      = require('../../domain/value-objects/MetodoPago');
const { TipoComprobante } = require('../../domain/value-objects/TipoComprobante');
const { MontosPago }      = require('../../domain/value-objects/MontosPago');
const logger = require('../../../../shared/logger/logger');

const ESTADOS_COBRABLES = ['Pendiente', 'En_Atencion', 'Completada'];

class ConfirmarPagoUseCase {
  constructor({ pagosRepository, citaValidator, coberturaValidator, eventPublisher, getConnection }) {
    this.pagosRepo          = pagosRepository;
    this.citaValidator      = citaValidator;
    this.coberturaValidator = coberturaValidator;
    this.eventPublisher     = eventPublisher;
    this.getConnection      = getConnection;
  }

  async ejecutar(dto, correlationId) {
    const {
      idCita, idPaciente, metodoPago, montoTotal, montoCubiertoSeguro,
      montoCopago, tipoComprobante, idValidacionCobertura,
      codigoAutorizacionSeguro, observaciones,
    } = dto;

    // ── 1. Validar campos obligatorios ────────────────────────────────────────
    if (!idCita || !idPaciente || !metodoPago || montoTotal === undefined || montoCopago === undefined) {
      throw new DomainError('DATOS_INVALIDOS', 400,
        'idCita, idPaciente, metodoPago, montoTotal y montoCopago son obligatorios');
    }

    // ── 2. Validar value objects (falla rápido) ───────────────────────────────
    let metodoPagoVO, tipoComprobanteVO, montosVO;
    try {
      metodoPagoVO      = new MetodoPago(metodoPago);
      tipoComprobanteVO = new TipoComprobante(tipoComprobante || 'BOLETA');
      montosVO          = new MontosPago({ montoTotal, montoCubiertoSeguro, montoCopago });
    } catch (err) {
      throw err;
    }

    // ── 3. Verificar estado de la cita (SVC-CIT-001) ─────────────────────────
    const estadoCita = await this.citaValidator.obtenerEstadoCita(idCita);
    if (!estadoCita) {
      throw new DomainError('CITA_NO_ENCONTRADA', 404, `La cita ${idCita} no existe`);
    }
    if (!ESTADOS_COBRABLES.includes(estadoCita.estado)) {
      throw new DomainError(
        'CITA_NO_COBRABLE', 409,
        `La cita debe estar en: ${ESTADOS_COBRABLES.join(' o ')}. Estado actual: ${estadoCita.estado}`
      );
    }

    // ── 4. Verificar cobertura si aplica (SVC-SEG-003) ───────────────────────
    // coberturaVerificada distingue DOS motivos por los que `cobertura` puede
    // quedar en null, que antes se trataban igual:
    //   - 404 limpio (el id no existe en Seguros): coberturaVerificada queda
    //     TRUE — no es "temporalmente no disponible", reintentarlo después no
    //     cambiaría nada, no hay nada que reconciliar.
    //   - SEG-003 inalcanzable (excepción): coberturaVerificada pasa a FALSE
    //     — este es el caso real que antes solo quedaba en un log y se perdía.
    //     Se persiste para que el recovery-replay (pagos.routes.js) lo
    //     encuentre y confirme la cobertura real en cuanto Seguros se
    //     recupere, en vez de dejar el pago silenciosamente sin verificar.
    let coberturaVerificada = true;
    if (idValidacionCobertura) {
      let cobertura = null;
      try {
        cobertura = await this.coberturaValidator.obtenerCobertura(idValidacionCobertura);
      } catch (err) {
        coberturaVerificada = false;
        logger.warn({ idValidacionCobertura, correlationId, err: err.message },
          'SVC-SEG-003 no disponible al confirmar pago. Continuando sin verificación de cobertura — queda pendiente de reconciliar.');
      }

      if (cobertura !== null) {
        if (cobertura.estadoCobertura !== 'APROBADA') {
          throw new DomainError('COBERTURA_NO_VALIDADA', 422,
            `La cobertura no está aprobada. Estado: ${cobertura.estadoCobertura}`);
        }
        if (cobertura.codigoAutorizacion !== (codigoAutorizacionSeguro || null)) {
          throw new DomainError('COBERTURA_NO_VALIDADA', 422,
            'El código de autorización no coincide con el registro de cobertura');
        }
      }
    }

    // ── 5. Construir entidad ──────────────────────────────────────────────────
    const pago = Pago.crear({
      idCita, idPaciente, idValidacionCobertura, codigoAutorizacionSeguro,
      coberturaVerificada,
      metodoPago:      metodoPagoVO,
      montos:          montosVO,
      tipoComprobante: tipoComprobanteVO,
      observaciones,
      correlationId,
    });

    // ── 6. TX: INSERT pago + INSERT outbox ────────────────────────────────────
    const conn = await this.getConnection();
    await conn.beginTransaction();

    try {
      // Verificar duplicado — excluir pagos REVERSADOS (se pueden re-cobrar)
      const [duplicado] = await conn.execute(
        `SELECT id_pago FROM svc_pag.pagos WHERE id_cita = ? AND estado != 'REVERSADO' FOR UPDATE`,
        [idCita]
      );
      if (duplicado.length > 0) {
        await conn.rollback();
        throw new DomainError('PAGO_DUPLICADO', 409,
          `La cita ${idCita} ya tiene un pago registrado (id: ${duplicado[0].id_pago})`);
      }

      await this.pagosRepo.save(pago, conn);

      // Publicar PagoAprobado — payload autocontenido para SVC-FAC
      await this.eventPublisher.publish(conn, 'PagoAprobado', {
        idPago:               pago.id,
        idCita:               pago.idCita,
        idPaciente:           pago.idPaciente,
        metodoPago:           pago.metodoPago,
        montoTotal:           pago.montoTotal,
        montoCubiertoSeguro:  pago.montoCubiertoSeguro,
        montoCopago:          pago.montoCopago,
        tieneCobertura:       pago.tieneCobertura(),
        coberturaVerificada:  pago.coberturaVerificada,
        tipoComprobante:      pago.tipoComprobante,
      }, correlationId);

      await conn.commit();

      // Métricas de negocio (Prometheus/Grafana): nº de pagos y monto total por
      // método. Vivían en el use case viejo pagos.usecases.js (no cableado).
      try {
        const { pagosCompletadosCounter, pagosMontoTotal } = require('../../../../config/metrics');
        pagosCompletadosCounter.inc({ metodo_pago: metodoPago });
        pagosMontoTotal.inc({ metodo_pago: metodoPago }, Number(montoTotal) || 0);
      } catch { /* la métrica nunca debe romper el pago */ }
    } catch (err) {
      await conn.rollback();
      if (err.code && err.httpStatus) throw err;
      if (err.code === 'ER_DUP_ENTRY') {
        throw new DomainError('PAGO_DUPLICADO', 409,
          `La cita ${idCita} ya tiene un pago registrado`);
      }
      logger.error({ err, correlationId }, 'Error al confirmar pago');
      throw new DomainError('ERROR_INTERNO_PAG', 500, 'Error al registrar el pago');
    } finally {
      conn.release();
    }

    // ── 7. Retornar DTO ───────────────────────────────────────────────────────
    return {
      idPago:               pago.id,
      idCita:               pago.idCita,
      estado:               pago.estado,
      metodoPago:           pago.metodoPago,
      montoTotal:           pago.montoTotal,
      montoCubiertoSeguro:  pago.montoCubiertoSeguro,
      montoCopago:          pago.montoCopago,
      tipoComprobante:      pago.tipoComprobante,
      coberturaVerificada:  pago.coberturaVerificada,
      mensaje: pago.necesitaVerificacionCobertura()
        ? 'Pago registrado. La cobertura no se pudo verificar en el momento (Seguros no disponible) — se confirmará sola cuando el servicio se recupere.'
        : 'Pago registrado. El comprobante se generará automáticamente.',
      correlationId,
    };
  }
}

module.exports = { ConfirmarPagoUseCase };
