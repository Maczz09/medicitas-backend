const db = require('../../../config/database');

class MySQLAuthRepository {
  async findUserByEmail(email) {
    const [rows] = await db.query(
      `SELECT u.*, r.nombre as rolNombre, s.failed_attempts, s.locked_until
       FROM medicitas_users.usuarios u
       JOIN medicitas_users.roles r ON u.id_rol = r.id_rol
       LEFT JOIN medicitas_users.user_security s ON u.id_usuario = s.id_usuario
       WHERE u.email = ? AND u.activo = 1`,
      [email]
    );
    return rows[0] || null;
  }

  async findUserById(id) {
    const [rows] = await db.query(
      `SELECT u.*, r.nombre as rolNombre, s.failed_attempts, s.locked_until, s.otp_code, s.otp_expires_at
       FROM medicitas_users.usuarios u
       JOIN medicitas_users.roles r ON u.id_rol = r.id_rol
       LEFT JOIN medicitas_users.user_security s ON u.id_usuario = s.id_usuario
       WHERE u.id_usuario = ? AND u.activo = 1`,
      [id]
    );
    return rows[0] || null;
  }

  async findUsuarioByIdAny(id) {
    const [rows] = await db.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.id_rol, u.id_medico, u.activo,
              u.created_at, u.updated_at, r.nombre AS rolNombre
       FROM medicitas_users.usuarios u
       JOIN medicitas_users.roles r ON u.id_rol = r.id_rol
       WHERE u.id_usuario = ?`,
      [id]
    );
    return rows[0] || null;
  }

  async findRoleByName(nombre) {
    const [rows] = await db.query(
      `SELECT * FROM medicitas_users.roles WHERE nombre = ?`,
      [nombre]
    );
    return rows[0] || null;
  }

  async createUser(user) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO medicitas_users.usuarios (id_usuario, id_rol, id_medico, nombre, apellido, email, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, user.idRol, user.idMedico || null, user.nombre, user.apellido, user.email, user.passwordHash]
      );
      await conn.query(
        `INSERT INTO medicitas_users.user_security (id_usuario) VALUES (?)`,
        [user.id]
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async listUsuarios({ q, offset, limit }) {
    const like = `%${q || ''}%`;
    const whereSearch = q
      ? `WHERE (u.nombre LIKE ? OR u.apellido LIKE ? OR u.email LIKE ? OR u.id_usuario LIKE ?)`
      : '';
    const searchParams = q ? [like, like, like, like] : [];

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM medicitas_users.usuarios u ${whereSearch}`,
      searchParams
    );

    const [rows] = await db.query(
      `SELECT u.id_usuario, u.nombre, u.apellido, u.email, u.id_rol, r.nombre AS rolNombre,
              u.id_medico, u.activo, u.created_at, u.updated_at
       FROM medicitas_users.usuarios u
       JOIN medicitas_users.roles r ON u.id_rol = r.id_rol
       ${whereSearch}
       ORDER BY u.created_at DESC
       LIMIT ${parseInt(limit, 10)} OFFSET ${parseInt(offset, 10)}`,
      searchParams
    );

    return { data: rows, total: countRows[0].total };
  }

  async incrementFailedAttempts(userId) {
    await db.query(
      `UPDATE medicitas_users.user_security SET failed_attempts = failed_attempts + 1 WHERE id_usuario = ?`,
      [userId]
    );
  }

  async resetFailedAttempts(userId) {
    await db.query(
      `UPDATE medicitas_users.user_security SET failed_attempts = 0, locked_until = NULL WHERE id_usuario = ?`,
      [userId]
    );
  }

  async lockAccount(userId, lockUntil) {
    await db.query(
      `UPDATE medicitas_users.user_security SET locked_until = ? WHERE id_usuario = ?`,
      [lockUntil, userId]
    );
  }

  async saveRefreshToken(userId, token, expiresAt) {
    await db.query(
      `UPDATE medicitas_users.user_security SET refresh_token = ?, refresh_expires_at = ? WHERE id_usuario = ?`,
      [token, expiresAt, userId]
    );
  }

  async findUserByRefreshToken(token) {
    const [rows] = await db.query(
      `SELECT u.*, r.nombre as rolNombre, s.refresh_expires_at 
       FROM medicitas_users.user_security s
       JOIN medicitas_users.usuarios u ON s.id_usuario = u.id_usuario
       JOIN medicitas_users.roles r ON u.id_rol = r.id_rol
       WHERE s.refresh_token = ? AND u.activo = 1`,
      [token]
    );
    return rows[0] || null;
  }

  async saveOTP(userId, otp, expiresAt) {
    await db.query(
      `UPDATE medicitas_users.user_security SET otp_code = ?, otp_expires_at = ? WHERE id_usuario = ?`,
      [otp, expiresAt, userId]
    );
  }

  async updatePassword(userId, passwordHash) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE medicitas_users.usuarios SET password_hash = ? WHERE id_usuario = ?`,
        [passwordHash, userId]
      );
      // Al cambiar clave, limpiar OTP y Refresh Tokens
      await conn.query(
        `UPDATE medicitas_users.user_security 
         SET otp_code = NULL, otp_expires_at = NULL, refresh_token = NULL, refresh_expires_at = NULL 
         WHERE id_usuario = ?`,
        [userId]
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async assignRole(userId, idRol) {
    await db.query(
      `UPDATE medicitas_users.usuarios SET id_rol = ? WHERE id_usuario = ?`,
      [idRol, userId]
    );
  }

  async updateUsuario(id, { nombre, apellido, email, idRol, activo }) {
    const fields = [];
    const params = [];
    if (nombre !== undefined)  { fields.push('nombre = ?');   params.push(nombre); }
    if (apellido !== undefined){ fields.push('apellido = ?'); params.push(apellido); }
    if (email !== undefined)   { fields.push('email = ?');    params.push(email); }
    if (idRol !== undefined)   { fields.push('id_rol = ?');   params.push(idRol); }
    if (activo !== undefined)  { fields.push('activo = ?');   params.push(activo ? 1 : 0); }
    if (fields.length === 0) return;
    params.push(id);
    await db.query(
      `UPDATE medicitas_users.usuarios SET ${fields.join(', ')} WHERE id_usuario = ?`,
      params
    );
  }
}

module.exports = MySQLAuthRepository;
