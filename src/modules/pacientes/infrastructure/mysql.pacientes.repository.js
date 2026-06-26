const defaultDb = require('../../../config/database');

class MySQLPacientesRepository {
  async findByDocumento(tipo_documento, numero_documento, conn = defaultDb) {
    const [rows] = await conn.query(
      `SELECT * FROM svc_pac.pacientes WHERE tipo_documento = ? AND numero_documento = ? AND activo = 1`,
      [tipo_documento, numero_documento]
    );
    return rows[0] || null;
  }

  async findById(idPaciente, conn = defaultDb) {
    const [rows] = await conn.query(
      `SELECT * FROM svc_pac.pacientes WHERE id_paciente = ? AND activo = 1`,
      [idPaciente]
    );
    return rows[0] || null;
  }

  async searchPaginated({ query, offset, limit }, conn = defaultDb) {
    // SQL_CALC_FOUND_ROWS optimiza la obtención del total sin tener que hacer otra query igual
    const searchPattern = `%${query || ''}%`;
    const [rows] = await conn.query(
      `SELECT SQL_CALC_FOUND_ROWS * 
       FROM svc_pac.pacientes 
       WHERE activo = 1 AND (
         nombre LIKE ? OR 
         apellido LIKE ? OR 
         numero_documento LIKE ?
       )
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [searchPattern, searchPattern, searchPattern, limit, offset]
    );

    const [[{ total }]] = await conn.query(`SELECT FOUND_ROWS() as total`);
    return { data: rows, total };
  }

  async create(paciente, conn = defaultDb) {
    await conn.query(
      `INSERT INTO svc_pac.pacientes (id_paciente, nombre, apellido, tipo_documento, numero_documento, fecha_nacimiento, sexo, telefono, email, direccion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paciente.id_paciente, paciente.nombre, paciente.apellido, paciente.tipo_documento, paciente.numero_documento,
        paciente.fecha_nacimiento, paciente.sexo, paciente.telefono,
        paciente.email, paciente.direccion
      ]
    );
  }

  async findByIdAny(idPaciente, conn = defaultDb) {
    const [rows] = await conn.query(
      `SELECT * FROM svc_pac.pacientes WHERE id_paciente = ?`,
      [idPaciente]
    );
    return rows[0] || null;
  }

  async update(idPaciente, fields, conn = defaultDb) {
    const allowed = [
      'nombre', 'apellido', 'tipo_documento', 'numero_documento',
      'fecha_nacimiento', 'sexo', 'telefono', 'email', 'direccion',
    ];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = ?`);
        params.push(fields[k]);
      }
    }
    if (sets.length === 0) return;
    params.push(idPaciente);
    await conn.query(`UPDATE svc_pac.pacientes SET ${sets.join(', ')} WHERE id_paciente = ?`, params);
  }

  async updateContact(idPaciente, { telefono, email, direccion }, conn = defaultDb) {
    await conn.query(
      `UPDATE svc_pac.pacientes SET telefono = ?, email = ?, direccion = ? WHERE id_paciente = ?`,
      [telefono, email, direccion, idPaciente]
    );
  }

  async updateEstado(idPaciente, activo, conn = defaultDb) {
    await conn.query(
      `UPDATE svc_pac.pacientes SET activo = ? WHERE id_paciente = ?`,
      [activo, idPaciente]
    );
  }
}

module.exports = MySQLPacientesRepository;
