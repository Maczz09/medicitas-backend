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
           fecha_hora              AS fecha,
           diagnostico_cie10       AS diagnosticoCie10,
           diagnostico_descripcion AS descripcion
         FROM svc_hcl.encuentros_clinicos
         WHERE id_expediente = ?
         ORDER BY fecha_hora DESC
         LIMIT ${limit} OFFSET ${offset}`,
        [idExpediente],
      );

      const encuentros = await Promise.all(rows.map(async (enc) => {
        const [prescs] = await conn.query(
          `SELECT id_prescripcion AS id, medicamento, dosis, frecuencia, duracion, indicaciones
           FROM svc_hcl.prescripciones_clinicas
           WHERE id_encuentro = ?`,
          [enc.idEncuentro],
        );
        return { ...enc, prescripciones: prescs };
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
