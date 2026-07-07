// Kill-switch en memoria para simular la caída de un módulo dentro del
// monolito (demostración de resiliencia: el resto del sistema sigue
// funcionando aunque un módulo esté "de baja"). No requiere reiniciar el
// contenedor — se activa/desactiva en caliente vía PATCH /api/v2/admin/servicios/:nombre.
// Se reinicia a habilitado=true en cada arranque del proceso (no persiste).

const estado = new Map();

function estaHabilitado(nombre) {
  return estado.get(nombre) !== false; // habilitado por defecto si nunca se tocó
}

function establecer(nombre, habilitado) {
  estado.set(nombre, !!habilitado);
}

module.exports = { estaHabilitado, establecer };
