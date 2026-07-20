const { DomainError } = require('../domain/errors');

// Único lugar que construye el DomainError de "dependencia caída" — evita que
// cada adaptador vuelva a armar el mensaje a mano (y el footgun ya documentado
// en citas/domain/cita.errors.js sobre las dos convenciones de argumentos de
// DomainError). Reusa el código DEPENDENCIA_NO_DISPONIBLE que ya existía en
// ValidarCoberturaUseCase.js en vez de inventar uno nuevo.
//
// Distingue "circuito abierto" (falla rápido, opossum ni intentó la llamada —
// err.code === 'EOPENBREAKER') de "reintentos agotados" (sí lo intentó 3
// veces y no hubo respuesta) porque son dos conceptos de resiliencia
// distintos y el usuario final entiende mejor cuál de los dos está pasando.
function crearErrorDependencia(servicioAfectado, errorOriginal) {
  const circuitoAbierto = errorOriginal?.code === 'EOPENBREAKER';
  const mensaje = circuitoAbierto
    ? `El servicio de ${servicioAfectado} no está disponible temporalmente (circuito de protección abierto tras fallos repetidos). El sistema dejó de intentarlo por unos segundos y se recuperará solo.`
    : `El servicio de ${servicioAfectado} no respondió tras varios intentos. Intenta de nuevo en unos momentos.`;

  return new DomainError('DEPENDENCIA_NO_DISPONIBLE', 503, mensaje, {
    motivo: circuitoAbierto ? 'CIRCUITO_ABIERTO' : 'REINTENTOS_AGOTADOS',
    servicio: servicioAfectado,
  });
}

module.exports = { crearErrorDependencia };
