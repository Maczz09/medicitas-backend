const defaultDb = require('../../../../../config/database');

class PacientesMySQLRepository {
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

  async searchPaginated({ query, offset, limit, estado = 'activo' }, conn = defaultDb) {
    // estado: 'activo' (default, preserva el comportamiento previo) | 'inactivo' | 'todos'
    // Sin este filtro, un paciente desactivado quedaba invisible para siempre —
    // ni el listado ni la búsqueda lo devolvían, así que no había forma de
    // encontrarlo de nuevo para reactivarlo.
    const filtroActivo =
      estado === 'inactivo' ? 'activo = 0' :
      estado === 'todos'    ? '1=1' :
      'activo = 1';

    // Solo cuando hay término de búsqueda pagamos el LIKE (con comodín inicial
    // NO usa índice → escaneo). El caso común —listar sin buscar— evita las 3
    // comparaciones LIKE por completo. Además se quitó SQL_CALC_FOUND_ROWS
    // (deprecado y lento: forzaba a MySQL a materializar TODO el resultado
    // ignorando el LIMIT en cada request); el total se cuenta aparte con un
    // COUNT(*) sobre el mismo filtro. Con el índice (activo, created_at) el
    // listado sin búsqueda queda ordenado por índice, sin filesort.
    const term = (query || '').trim();
    const params = [];
    let whereBusqueda = '';
    if (term) {
      const searchPattern = `%${term}%`;
      whereBusqueda = ' AND (nombre LIKE ? OR apellido LIKE ? OR numero_documento LIKE ?)';
      params.push(searchPattern, searchPattern, searchPattern);
    }

    const [rows] = await conn.query(
      `SELECT *
       FROM svc_pac.pacientes
       WHERE ${filtroActivo}${whereBusqueda}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await conn.query(
      `SELECT COUNT(*) AS total FROM svc_pac.pacientes WHERE ${filtroActivo}${whereBusqueda}`,
      params
    );
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

module.exports = PacientesMySQLRepository;
