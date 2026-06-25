class DomainError extends Error {
  // Soporta las DOS convenciones que conviven en el proyecto:
  //   new DomainError(codigo, mensaje, status)   ← clases base de abajo
  //   new DomainError(codigo, status, mensaje)   ← módulos seguros/pagos/facturación
  // Se detecta cuál es el número (status) y cuál el texto (mensaje).
  constructor(codigo, arg2, arg3) {
    let mensaje;
    let status;
    if (typeof arg2 === 'number') {
      status = arg2;
      mensaje = arg3;
    } else {
      mensaje = arg2;
      status = typeof arg3 === 'number' ? arg3 : 400;
    }
    super(mensaje);
    this.name = this.constructor.name;
    this.codigo = codigo;
    this.code = codigo; // alias usado por algunos call sites
    this.status = status || 400;
    this.httpStatus = this.status; // alias usado por algunos call sites
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
