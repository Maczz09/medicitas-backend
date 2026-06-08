const { DomainError } = require('../../../../../shared/domain/errors');

class EncuentroMySQLRepository {
  constructor(pool) {
    this.pool = pool; // pool de svc_hcl
  }

  async findPaginadoByExpediente(idExpediente, { pagina, porPagina }) {
    const conn = await this.pool.getConnection();
    try {
      const limit = parseInt(porPagina, 10);
      const offset = (parseInt(pagina, 10) - 1) * limit;

      const [rows] = await conn.execute(`
        SELECT SQL_CALC_FOUND_ROWS 
          e.id_encuentro AS idEncuentro,
          e.id_cita AS idCita,
          e.id_medico AS idMedico,
          e.fecha_hora AS fecha,
          e.diagnostico_cie10 AS diagnosticoCie10,
          e.diagnostico_descripcion AS descripcion
        FROM svc_hcl.encuentros_clinicos e
        WHERE e.id_expediente = ?
        ORDER BY e.fecha_hora DESC
        LIMIT ? OFFSET ?
      `, [idExpediente, limit, offset]);

      const [[{ total }]] = await conn.query(`SELECT FOUND_ROWS() as total`);

      // Para cada encuentro, traer prescripciones
      const encuentros = await Promise.all(rows.map(async (enc) => {
        const [prescs] = await conn.execute(`
          SELECT id_prescripcion as id, medicamento, dosis, frecuencia, duracion, indicaciones 
          FROM svc_hcl.prescripciones_clinicas 
          WHERE id_encuentro = ?
        `, [enc.idEncuentro]);

        return {
          ...enc,
          prescripciones: prescs
        };
      }));

      return {
        total,
        pagina: parseInt(pagina, 10),
        porPagina: limit,
        encuentros
      };
    } catch (err) {
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
       (id_prescripcion, id_encuentro, id_paciente, medicamento, dosis, frecuencia, duracion, indicaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prescripcion.id, 
        prescripcion.idEncuentro, 
        prescripcion.idPaciente, 
        medicamento, 
        dosis, 
        'No especificado', // El ValueObject no tenía frecuencia
        cantidad || '1',   // El ValueObject usaba cantidad
        indicaciones || null
      ]
    );
  }
}

module.exports = { EncuentroMySQLRepository };
