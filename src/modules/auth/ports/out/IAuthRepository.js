class IAuthRepository {
  async findUserByEmail(email)                       { throw new Error('No implementado'); }
  async findUserById(id)                              { throw new Error('No implementado'); }
  async findUsuarioByIdAny(id)                        { throw new Error('No implementado'); }
  async findRoleByName(nombre)                        { throw new Error('No implementado'); }
  async createUser(user)                              { throw new Error('No implementado'); }
  async listUsuarios({ q, offset, limit })            { throw new Error('No implementado'); }
  async incrementFailedAttempts(userId)               { throw new Error('No implementado'); }
  async resetFailedAttempts(userId)                   { throw new Error('No implementado'); }
  async lockAccount(userId, lockUntil)                { throw new Error('No implementado'); }
  async saveRefreshToken(userId, token, expiresAt)    { throw new Error('No implementado'); }
  async findUserByRefreshToken(token)                 { throw new Error('No implementado'); }
  async saveOTP(userId, otp, expiresAt)               { throw new Error('No implementado'); }
  async updatePassword(userId, passwordHash)          { throw new Error('No implementado'); }
  async assignRole(userId, idRol)                     { throw new Error('No implementado'); }
  async updateUsuario(id, fields)                     { throw new Error('No implementado'); }
}

module.exports = { IAuthRepository };
