const { Expediente } = require('../../../domain/entities/Expediente');
const { DomainError } = require('../../../../../shared/domain/errors');

class ExpedienteMySQLRepository {
  constructor(pool) {
    this.pool = pool; // pool de svc_hcl
  }

  async findByIdPaciente(idPaciente) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(
        'SELECT id_expediente as id, id_paciente, grupo_sanguineo, alergias_conocidas FROM svc_hcl.expedientes WHERE id_paciente = ?',
        [idPaciente]
      );
      if (rows.length === 0) return null;

      const row = rows[0];
      return new Expediente({
        id: row.id,
        idPaciente: row.id_paciente,
        grupoSanguineo: row.grupo_sanguineo,
        alergias: row.alergias_conocidas || [],
      });
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al consultar expediente', 500);
    } finally {
      conn.release();
    }
  }

  async findResumenByIdPaciente(idPaciente) {
    const conn = await this.pool.getConnection();
    try {
      const [rows] = await conn.execute(`
        SELECT
          e.id_expediente   AS idExpediente,
          e.id_paciente     AS idPaciente,
          e.grupo_sanguineo AS grupoSanguineo,
          e.alergias_conocidas AS alergias,
          ec.id_encuentro   AS idUltimoEncuentro,
          ec.diagnostico_cie10 AS diagnosticoCie10,
          ec.fecha_hora AS fechaUltimaAtencion
        FROM svc_hcl.expedientes e
        LEFT JOIN svc_hcl.encuentros_clinicos ec
          ON ec.id_expediente = e.id_expediente
        WHERE e.id_paciente = ?
        ORDER BY ec.fecha_hora DESC
        LIMIT 1
      `, [idPaciente]);

      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        idExpediente:    row.idExpediente,
        idPaciente:      row.idPaciente,
        grupoSanguineo:  row.grupoSanguineo,
        alergiasConocidas: row.alergias || [],
        ultimaAtencion: row.idUltimoEncuentro ? {
          idEncuentro:    row.idUltimoEncuentro,
          fecha:          row.fechaUltimaAtencion,
          diagnosticoCie10: row.diagnosticoCie10,
          enlaceDetalle:  `/api/v1/historias-clinicas/encuentros/${row.idUltimoEncuentro}`,
        } : null,
      };
    } catch (err) {
      throw new DomainError('ERROR_INTERNO_HCL', 'Error al consultar resumen clínico', 500);
    } finally {
      conn.release();
    }
  }

  async save(expediente, connection) {
    await connection.execute(
      `INSERT INTO svc_hcl.expedientes (id_expediente, id_paciente, grupo_sanguineo, alergias_conocidas)
       VALUES (?, ?, ?, ?)`,
      [expediente.id, expediente.idPaciente, expediente.grupoSanguineo,
       JSON.stringify(expediente.alergias)]
    );
  }

  async update(idPaciente, { grupoSanguineo, alergias }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.execute(
        `UPDATE svc_hcl.expedientes
         SET grupo_sanguineo = ?, alergias_conocidas = ?
         WHERE id_paciente = ?`,
        [grupoSanguineo || null, JSON.stringify(alergias || []), idPaciente],
      );
    } finally {
      conn.release();
    }
  }
}

module.exports = { ExpedienteMySQLRepository };
