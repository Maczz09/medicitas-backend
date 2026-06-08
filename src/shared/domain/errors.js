class DomainError extends Error {
  constructor(codigo, mensaje, status = 400) {
    super(mensaje);
    this.name = this.constructor.name;
    this.codigo = codigo;
    this.status = status;
  }
}

class ValidationError extends DomainError {
  constructor(mensaje) {
    super('REQUEST_MALFORMADO', mensaje, 400);
  }
}

class UnauthorizedError extends DomainError {
  constructor(mensaje = 'Se requiere autenticación') {
    super('TOKEN_REQUERIDO', mensaje, 401);
  }
}

class ForbiddenError extends DomainError {
  constructor(mensaje = 'Permisos insuficientes') {
    super('ROL_INSUFICIENTE', mensaje, 403);
  }
}

class NotFoundError extends DomainError {
  constructor(codigo = 'NO_ENCONTRADO', mensaje = 'Recurso no encontrado') {
    super(codigo, mensaje, 404);
  }
}

class ConflictError extends DomainError {
  constructor(codigo = 'CONFLICTO', mensaje = 'Conflicto de negocio') {
    super(codigo, mensaje, 409);
  }
}

module.exports = {
  DomainError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
