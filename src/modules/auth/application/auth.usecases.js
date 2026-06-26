const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  AuthValidationError,
  AccountLockedError,
  InvalidCredentialsError,
  ResourceNotFoundError,
  UserConflictError,
  InvalidOTPError,
  InvalidTokenError
} = require('../domain/auth.errors');
const mailerService = require('../../../shared/infrastructure/mailer');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const MAX_FAILED_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;

class AuthUseCases {
  constructor(authRepository) {
    this.authRepository = authRepository;
  }

  _generateAccessToken(user) {
    return jwt.sign(
      {
        sub: user.id_usuario, // estándar JWT; varios módulos (HCL) leen req.user.sub
        idUsuario: user.id_usuario,
        email: user.email,
        nombre: `${user.nombre} ${user.apellido}`,
        idRol: user.id_rol,
        idMedico: user.id_medico || null, // vínculo médico↔usuario (agenda propia, etc.)
        rolNombre: user.rolNombre
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
  }

  _generateRefreshToken() {
    return crypto.randomBytes(40).toString('hex');
  }

  _generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async login(email, password) {
    if (!EMAIL_REGEX.test(email)) throw new AuthValidationError('Formato de correo inválido');

    const user = await this.authRepository.findUserByEmail(email);
    if (!user) throw new InvalidCredentialsError();

    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      throw new AccountLockedError();
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      await this.authRepository.incrementFailedAttempts(user.id_usuario);
      const attempts = (user.failed_attempts || 0) + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000);
        await this.authRepository.lockAccount(user.id_usuario, lockUntil);
        throw new AccountLockedError();
      }
      throw new InvalidCredentialsError();
    }

    await this.authRepository.resetFailedAttempts(user.id_usuario);

    const accessToken = this._generateAccessToken(user);
    const refreshToken = this._generateRefreshToken();
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días

    await this.authRepository.saveRefreshToken(user.id_usuario, refreshToken, refreshExpires);

    return { accessToken, refreshToken, rol: user.rolNombre };
  }

  async refreshToken(token) {
    if (!token) throw new AuthValidationError('Refresh token es requerido');

    const user = await this.authRepository.findUserByRefreshToken(token);
    if (!user || new Date() > new Date(user.refresh_expires_at)) {
      throw new InvalidTokenError();
    }

    const newAccessToken = this._generateAccessToken(user);
    const newRefreshToken = this._generateRefreshToken();
    const refreshExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.authRepository.saveRefreshToken(user.id_usuario, newRefreshToken, refreshExpires);

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async register({ nombre, apellido, email, password, rolNombre, idMedico = null }) {
    if (!EMAIL_REGEX.test(email)) throw new AuthValidationError('Formato de correo inválido');
    if (!PASSWORD_REGEX.test(password)) {
      throw new AuthValidationError('La contraseña debe tener 8 caracteres, mayúscula, minúscula, número y carácter especial');
    }

    const existing = await this.authRepository.findUserByEmail(email);
    if (existing) throw new UserConflictError('El correo ya está registrado');

    const rol = await this.authRepository.findRoleByName(rolNombre);
    if (!rol) throw new ResourceNotFoundError(`El rol '${rolNombre}' no existe`);

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    await this.authRepository.createUser({
      id,
      idRol: rol.id_rol,
      idMedico,
      nombre,
      apellido,
      email,
      passwordHash
    });

    return { id, email, rol: rol.nombre, idMedico };
  }

  async actualizarUsuario(id, dto) {
    const user = await this.authRepository.findUsuarioByIdAny(id);
    if (!user) throw new ResourceNotFoundError('Usuario no encontrado');

    if (dto.email !== undefined) {
      if (!EMAIL_REGEX.test(dto.email)) throw new AuthValidationError('Formato de correo inválido');
      if (dto.email !== user.email) {
        const existing = await this.authRepository.findUserByEmail(dto.email);
        if (existing) throw new UserConflictError('El correo ya está registrado');
      }
    }

    let idRol;
    if (dto.rolNombre) {
      const rol = await this.authRepository.findRoleByName(dto.rolNombre);
      if (!rol) throw new ResourceNotFoundError(`El rol '${dto.rolNombre}' no existe`);
      idRol = rol.id_rol;
    }

    await this.authRepository.updateUsuario(id, {
      nombre: dto.nombre,
      apellido: dto.apellido,
      email: dto.email,
      idRol,
      activo: dto.activo,
    });

    const updated = await this.authRepository.findUsuarioByIdAny(id);
    return {
      id_usuario: updated.id_usuario,
      nombre: updated.nombre,
      apellido: updated.apellido,
      email: updated.email,
      rolNombre: updated.rolNombre,
      id_medico: updated.id_medico,
      activo: updated.activo,
    };
  }

  async listUsuarios(q, page = 1, limit = 10) {
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const offset = (p - 1) * l;

    const { data, total } = await this.authRepository.listUsuarios({ q, offset, limit: l });
    return {
      data,
      meta: { total, page: p, limit: l, totalPages: Math.ceil(total / l) },
    };
  }

  async generateOTP(email) {
    if (!EMAIL_REGEX.test(email)) throw new AuthValidationError('Formato de correo inválido');

    const user = await this.authRepository.findUserByEmail(email);
    if (!user) throw new ResourceNotFoundError('Correo no encontrado');

    const otp = this._generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 minutos

    await this.authRepository.saveOTP(user.id_usuario, otp, expiresAt);
    await mailerService.sendOTP(user.email, otp);
  }

  async resetPassword(email, otpCode, newPassword) {
    if (!EMAIL_REGEX.test(email)) throw new AuthValidationError('Formato de correo inválido');
    if (!PASSWORD_REGEX.test(newPassword)) {
      throw new AuthValidationError('La contraseña nueva debe cumplir con los requisitos de seguridad');
    }

    const user = await this.authRepository.findUserByEmail(email);
    if (!user) throw new ResourceNotFoundError('Correo no encontrado');

    const freshUser = await this.authRepository.findUserById(user.id_usuario);
    if (!freshUser.otp_code || freshUser.otp_code !== otpCode || new Date() > new Date(freshUser.otp_expires_at)) {
      throw new InvalidOTPError();
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.authRepository.updatePassword(user.id_usuario, passwordHash);
    await this.authRepository.resetFailedAttempts(user.id_usuario);
  }

  async assignRole(idUsuario, rolNombre) {
    const user = await this.authRepository.findUserById(idUsuario);
    if (!user) throw new ResourceNotFoundError('Usuario no encontrado');

    const rol = await this.authRepository.findRoleByName(rolNombre);
    if (!rol) throw new ResourceNotFoundError('Rol no válido');

    await this.authRepository.assignRole(user.id_usuario, rol.id_rol);
    return { id: idUsuario, nuevoRol: rolNombre };
  }
}

module.exports = AuthUseCases;
