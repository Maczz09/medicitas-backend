const { DomainError } = require('../../../../../shared/domain/errors');

class EncuentroMySQLRepository {
  constructor(pool) {
    this.pool = pool; // pool de svc_hcl
  }

  async findPaginadoByExpediente(idExpediente, { pagina, porPagina }) {
    const conn = await this.pool.getConnection();
    try {
      const limit  = parseInt(porPagina, 10);
      const offset = (parseInt(pagina, 10) - 1) * limit;

      const [[{ total }]] = await conn.query(
        'SELECT COUNT(*) AS total FROM svc_hcl.encuentros_clinicos WHERE id_expediente = ?',
        [idExpediente],
      );

      const [rows] = await conn.query(
        `SELECT
           id_encuentro            AS idEncuentro,
           id_cita                 AS idCita,
           id_medico               AS idMedico,
           cita_completada_verificada AS citaCompletadaVerificada,
           fecha_hora              AS fecha,
           diagnostico_cie10       AS diagnosticoCie10,
           diagnostico_descripcion AS descripcion
         FROM svc_hcl.encuentros_clinicos
         WHERE id_expediente = ?
         ORDER BY fecha_hora DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [idExpediente],
      );

      // Antes: una query de prescripciones POR CADA encuentro del page (N+1).
      // Ahora: una sola query con WHERE id_encuentro IN (...) y se agrupa en
      // memoria — 1 round-trip en vez de N.
      const ids = rows.map((e) => e.idEncuentro);
      let porEncuentro = new Map();
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const [prescs] = await conn.query(
          `SELECT id_prescripcion AS id, id_encuentro AS idEncuentro,
                  medicamento, dosis, frecuencia, duracion, indicaciones
           FROM svc_hcl.prescripciones_clinicas
           WHERE id_encuentro IN (${placeholders})`,
          ids,
        );
        for (const p of prescs) {
          if (!porEncuentro.has(p.idEncuentro)) porEncuentro.set(p.idEncuentro, []);
          const { idEncuentro, ...pres } = p;
          porEncuentro.get(p.idEncuentro).push(pres);
        }
      }

      const encuentros = rows.map((enc) => ({
        ...enc,
        citaCompletadaVerificada: !!enc.citaCompletadaVerificada,
        prescripciones: porEncuentro.get(enc.idEncuentro) || [],
      }));

      return { total, pagina: parseInt(pagina, 10), porPagina: limit, encuentros };
    } catch (err) {
      console.error('[EncuentroRepo] findPaginadoByExpediente error:', err.message);
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al consultar encuentros clínicos', 500);
    } finally {
      conn.release();
    }
  }

  async save(encuentro, connection) {
    await connection.execute(
      `INSERT INTO svc_hcl.encuentros_clinicos 
       (id_encuentro, id_expediente, id_cita, id_medico, diagnostico_cie10, diagnostico_descripcion, fecha_hora)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        encuentro.id, encuentro.idExpediente, encuentro.idCita, encuentro.idMedico,
        encuentro.diagnosticoCie10, encuentro.descripcion, encuentro.fechaEncuentro
      ]
    );
  }

  // Se llama post-commit (fuera de la TX de save(), ya liberada) cuando
  // completarCita() falló por Citas inalcanzable — abre su propia conexión.
  async marcarCitaPendienteReconciliar(idEncuentro) {
    const conn = await this.pool.getConnection();
    try {
      await conn.execute(
        'UPDATE svc_hcl.encuentros_clinicos SET cita_completada_verificada = 0 WHERE id_encuentro = ?',
        [idEncuentro]
      );
    } finally {
      conn.release();
    }
  }

  // Encuentros cuya cita no se pudo confirmar como Completada — candidatos a
  // reconciliar cuando HistoriaClinica→Citas se recupera. Newest-first, mismo
  // criterio que Seguros/Pagos: el registro reciente, con alguien mirando la
  // pantalla, se beneficia más de una corrección instantánea que uno viejo.
  async findPendientesCompletarCita(limit) {
    const conn = await this.pool.getConnection();
    try {
      const limiteSeguro = Number.isInteger(Number(limit)) ? Number(limit) : 20;
      const [rows] = await conn.query(
        `SELECT id_encuentro AS idEncuentro, id_cita AS idCita
         FROM svc_hcl.encuentros_clinicos
         WHERE cita_completada_verificada = 0
         ORDER BY fecha_hora DESC
         LIMIT ${limiteSeguro}`
      );
      return rows;
    } finally {
      conn.release();
    }
  }

  // Recibe conexión de la TX del caller (recovery-replay). Devuelve
  // affectedRows para que el caller detecte si otro worker del clúster ya
  // reconcilió esta fila antes y evite publicar un evento duplicado.
  async marcarCitaCompletadaVerificada(idEncuentro, connection) {
    const [result] = await connection.execute(
      `UPDATE svc_hcl.encuentros_clinicos SET cita_completada_verificada = 1
       WHERE id_encuentro = ? AND cita_completada_verificada = 0`,
      [idEncuentro]
    );
    return result.affectedRows;
  }

  async savePrescripcion(prescripcion, connection) {
    const { medicamento, dosis, indicaciones, cantidad } = prescripcion.contenido;
    await connection.execute(
      `INSERT INTO svc_hcl.prescripciones_clinicas 
       (id_prescripcion, id_encuentro, id_paciente, medicamento, dosis, frecuencia, duracion, cantidad, indicaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prescripcion.id, 
        prescripcion.idEncuentro, 
        prescripcion.idPaciente, 
        medicamento, 
        dosis, 
        'No especificado', // El ValueObject no tenía frecuencia
        null,              // duracion
        cantidad || 1,     // nueva columna cantidad
        indicaciones || null
      ]
    );
  }
}

module.exports = { EncuentroMySQLRepository };
