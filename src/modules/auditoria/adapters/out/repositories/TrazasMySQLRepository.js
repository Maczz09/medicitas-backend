const { Traza } = require('../../../domain/entities/Traza');
const { DomainError } = require('../../../../../shared/domain/errors');

class TrazasMySQLRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async insertar(traza) {
    const conn = await this.pool.getConnection();
    try {
      // Tabla real: svc_aud.trazas_auditoria
      //   (id_traza, id_evento, tipo_evento, servicio_origen, correlation_id, payload, registrado_en)
      await conn.execute(
        `INSERT INTO svc_aud.trazas_auditoria
         (id_traza, id_evento, tipo_evento, servicio_origen, correlation_id, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          traza.id, traza.idEvento, traza.tipoEvento, traza.servicioOrigen,
          traza.correlationId, JSON.stringify(traza.payload),
        ]
      );
      return { insertada: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        // Idempotencia: el evento ya fue registrado — NO es un error
        return { insertada: false };
      }
      throw new DomainError('ERROR_INTERNO_AUD', 500, 'Error al insertar la traza');
    } finally {
      conn.release();
    }
  }

  async buscarConFiltros({ servicio, tipoEvento, desde, hasta, correlationId, pagina, porPagina }) {
    const conn = await this.pool.getConnection();
    try {
      const condiciones = [];
      const params       = [];

      if (servicio)      { condiciones.push('servicio_origen = ?'); params.push(servicio); }
      if (tipoEvento)    { condiciones.push('tipo_evento = ?');     params.push(tipoEvento); }
      if (correlationId) { condiciones.push('correlation_id = ?');  params.push(correlationId); }
      if (desde)         { condiciones.push('registrado_en >= ?');  params.push(desde); }
      if (hasta)         { condiciones.push('registrado_en <= ?');  params.push(hasta); }

      const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
      // LIMIT/OFFSET se interpolan como enteros: mysql2 .execute() rechaza placeholders aquí.
      const limitN = parseInt(porPagina, 10) || 20;
      const offsetN = (parseInt(pagina, 10) - 1) * limitN;

      // Total para la paginación
      const [totalRows] = await conn.execute(
        `SELECT COUNT(*) AS total FROM svc_aud.trazas_auditoria ${whereClause}`,
        params
      );

      // Resultados de la página (más recientes primero)
      const [rows] = await conn.execute(
        `SELECT id_traza, id_evento, servicio_origen, tipo_evento,
                payload, correlation_id, registrado_en
         FROM svc_aud.trazas_auditoria ${whereClause}
         ORDER BY registrado_en DESC
         LIMIT ${limitN} OFFSET ${offsetN}`,
        params
      );

      return {
        total: totalRows[0].total,
        trazas: rows.map(this._mapear),
      };
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_AUD', 500, 'Error al consultar trazas');
    } finally {
      conn.release();
    }
  }

  async buscarPorCorrelationId(correlationId) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT id_traza, id_evento, servicio_origen, tipo_evento,
                payload, correlation_id, registrado_en
         FROM svc_aud.trazas_auditoria
         WHERE correlation_id = ?
         ORDER BY registrado_en ASC`,  // Cronológico — del primero al último
        [correlationId]
      );
      return rows.map(this._mapear);
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_AUD', 500, 'Error al buscar trazas por correlación');
    } finally {
      conn.release();
    }
  }

  _mapear(r) {
    const traza = new Traza({
      id:              r.id_traza,
      idEvento:        r.id_evento,
      servicioOrigen:  r.servicio_origen,
      tipoEvento:      r.tipo_evento,
      routingKey:      null,
      payload:         typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      correlationId:   r.correlation_id,
      timestampOrigen: null,
    });
    traza.recibidoEn = r.registrado_en;
    return traza;
  }
}

module.exports = { TrazasMySQLRepository };
