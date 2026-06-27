const { DomainError } = require('../../../shared/domain/errors');

class AuthValidationError extends DomainError {
  constructor(message = 'Validación fallida: credenciales, sintaxis o reglas débiles') {
    super('AUTH_VALIDATION_ERROR', message, 400);
  }
}

class AccountLockedError extends DomainError {
  constructor(unlockAt) {
    super('ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente por múltiples intentos fallidos', 401);
    this.meta = unlockAt ? { unlockAt: new Date(unlockAt).toISOString() } : null;
  }
}

class UserNotFoundError extends DomainError {
  constructor() {
    super('USER_NOT_FOUND', 'No existe ninguna cuenta con ese correo electrónico', 401);
  }
}

class WrongPasswordError extends DomainError {
  constructor(remaining) {
    const msg = remaining === 1
      ? `Contraseña incorrecta. ¡Cuidado! Solo te queda 1 intento antes del bloqueo`
      : `Contraseña incorrecta. Te quedan ${remaining} intentos`;
    super('WRONG_PASSWORD', msg, 401);
    this.meta = { remaining };
  }
}

class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Email o contraseña incorrectos', 401);
  }
}

class ResourceNotFoundError extends DomainError {
  constructor(message = 'El recurso solicitado no existe (Ej. usuario no encontrado)') {
    super('RESOURCE_NOT_FOUND', message, 404);
  }
}

class UserConflictError extends DomainError {
  constructor(message = 'El usuario o correo ingresado ya existe en el sistema') {
    super('USER_CONFLICT', message, 409);
  }
}

class InvalidOTPError extends DomainError {
  constructor(message = 'El código proporcionado es incorrecto o ha expirado') {
    super('INVALID_OTP', message, 422);
  }
}

class InvalidTokenError extends DomainError {
  constructor(message = 'El token proporcionado no es válido o ya fue utilizado') {
    super('INVALID_TOKEN', message, 422);
  }
}

module.exports = {
  AuthValidationError,
  AccountLockedError,
  UserNotFoundError,
  WrongPasswordError,
  InvalidCredentialsError,
  ResourceNotFoundError,
  UserConflictError,
  InvalidOTPError,
  InvalidTokenError
};
