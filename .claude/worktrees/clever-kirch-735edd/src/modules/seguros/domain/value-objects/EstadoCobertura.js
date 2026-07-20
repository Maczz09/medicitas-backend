const EstadoCobertura = Object.freeze({
  APROBADA:  'APROBADA',
  RECHAZADA: 'RECHAZADA',
  PENDIENTE: 'PENDIENTE',
});

function esEstadoValido(estado) {
  return Object.values(EstadoCobertura).includes(estado);
}

module.exports = { EstadoCobertura, esEstadoValido };
