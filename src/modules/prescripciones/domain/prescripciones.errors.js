const { DomainError } = require('../../../shared/domain/errors');

module.exports = {
  RECETA_NO_ENCONTRADA: (id) => new DomainError('RECETA_NO_ENCONTRADA', 404, `No existe receta con id ${id}.`),
  RECETA_NO_RECHAZADA: (estado) => new DomainError('RECETA_NO_RECHAZADA', 409, `Solo se pueden reintentar despachos en estado RECHAZADA. Estado actual: ${estado}.`),
  RECETA_NO_DESPACHADA: (estado) => new DomainError('RECETA_NO_DESPACHADA', 409, `Solo se pueden retirar despachos en estado DESPACHADA. Estado actual: ${estado}.`)
};
