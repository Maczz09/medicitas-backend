const { DomainError } = require('../../../shared/domain/errors');

class AuthValidationError extends DomainError {
  constructor(message = 'Validación fallida: credenciales, sintaxis o reglas débiles') {
    super('AUTH_VALIDATION_ERROR', message, 400);
  }
}

class AccountLockedError extends DomainError {
  constructor() {
    super('ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente por múltiples intentos fallidos', 401);
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
  InvalidCredentialsError,
  ResourceNotFoundError,
  UserConflictError,
  InvalidOTPError,
  InvalidTokenError
};
