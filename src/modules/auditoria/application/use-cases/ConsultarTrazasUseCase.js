const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarTrazasUseCase {
  constructor({ trazasRepository }) {
    this.trazasRepo = trazasRepository;
  }

  async ejecutar({ servicio, tipoEvento, desde, hasta, correlationId, pagina, porPagina }) {
    // ── Validar paginación ────────────────────────────────────────────────────
    const p  = parseInt(pagina    || '1', 10);
    const pp = parseInt(porPagina || '20', 10);
    if (isNaN(p) || p < 1 || isNaN(pp) || pp < 1 || pp > 100) {
      throw new DomainError('FILTROS_INVALIDOS', 400,
        'pagina debe ser >= 1 y porPagina debe estar entre 1 y 100');
    }

    // ── Validar fechas si fueron proporcionadas ───────────────────────────────
    let desdeDate = null, hastaDate = null;
    if (desde) {
      desdeDate = new Date(desde);
      if (isNaN(desdeDate.getTime())) {
        throw new DomainError('FILTROS_INVALIDOS', 400, `Fecha 'desde' inválida: ${desde}`);
      }
    }
    if (hasta) {
      hastaDate = new Date(hasta);
      if (isNaN(hastaDate.getTime())) {
        throw new DomainError('FILTROS_INVALIDOS', 400, `Fecha 'hasta' inválida: ${hasta}`);
      }
    }
    if (desdeDate && hastaDate && desdeDate > hastaDate) {
      throw new DomainError('FILTROS_INVALIDOS', 400, "'desde' no puede ser posterior a 'hasta'");
    }

    const { total, trazas } = await this.trazasRepo.buscarConFiltros({
      servicio:      servicio      || null,
      tipoEvento:    tipoEvento    || null,
      desde:         desdeDate,
      hasta:         hastaDate,
      correlationId: correlationId || null,
      pagina: p,
      porPagina: pp,
    });

    return {
      total,
      pagina: p,
      porPagina: pp,
      trazas: trazas.map(this._toDTO),
    };
  }

  _toDTO(traza) {
    return {
      id:              traza.id,
      idEvento:        traza.idEvento,
      servicioOrigen:  traza.servicioOrigen,
      tipoEvento:      traza.tipoEvento,
      routingKey:      traza.routingKey,
      payload:         traza.payload,
      correlationId:   traza.correlationId,
      timestampOrigen: traza.timestampOrigen,
      recibidoEn:      traza.recibidoEn,
    };
  }
}

module.exports = { ConsultarTrazasUseCase };
