const { Traza } = require('../../../domain/entities/Traza');
const { DomainError } = require('../../../../../shared/domain/errors');

class TrazasMySQLRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async insertar(traza) {
    const conn = await this.pool.getConnection();
    try {
      await conn.execute(
        `INSERT INTO svc_aud.trazas
         (id, id_evento, servicio_origen, tipo_evento, routing_key,
          payload, correlation_id, timestamp_origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          traza.id, traza.idEvento, traza.servicioOrigen, traza.tipoEvento,
          traza.routingKey, JSON.stringify(traza.payload),
          traza.correlationId, traza.timestampOrigen,
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
      if (desde)         { condiciones.push('recibido_en >= ?');    params.push(desde); }
      if (hasta)         { condiciones.push('recibido_en <= ?');    params.push(hasta); }

      const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
      const offset = (pagina - 1) * porPagina;

      // Total para la paginación
      const [totalRows] = await conn.execute(
        `SELECT COUNT(*) AS total FROM svc_aud.trazas ${whereClause}`,
        params
      );

      // Resultados de la página (más recientes primero)
      const [rows] = await conn.execute(
        `SELECT id, id_evento, servicio_origen, tipo_evento, routing_key,
                payload, correlation_id, timestamp_origen, recibido_en
         FROM svc_aud.trazas ${whereClause}
         ORDER BY recibido_en DESC
         LIMIT ? OFFSET ?`,
        [...params, porPagina, offset]
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
        `SELECT id, id_evento, servicio_origen, tipo_evento, routing_key,
                payload, correlation_id, timestamp_origen, recibido_en
         FROM svc_aud.trazas
         WHERE correlation_id = ?
         ORDER BY recibido_en ASC`,  // Cronológico — del primero al último
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
    return new Traza({
      id:              r.id,
      idEvento:        r.id_evento,
      servicioOrigen:  r.servicio_origen,
      tipoEvento:      r.tipo_evento,
      routingKey:      r.routing_key,
      payload:         typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      correlationId:   r.correlation_id,
      timestampOrigen: r.timestamp_origen,
      recibidoEn:      r.recibido_en,
    });
  }
}

module.exports = { TrazasMySQLRepository };
