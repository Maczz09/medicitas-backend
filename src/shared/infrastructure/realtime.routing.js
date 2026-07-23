const logger = require('../logger/logger');

// Cada evento se mapea a los MISMOS roles que ya exige el requireRole(...) del
// GET/listado del módulo dueño de ese evento — no es una regla nueva, es la
// que ya existe y ya se audita en cada *.routes.js. Mantener esta tabla en
// sync con esos requireRole si cambian.
const MAPA_ROLES_POR_EVENTO = {
  // citas.routes.js:99 — GET /api/v2/citas
  CitaReservada: ['Recepcionista', 'Médico', 'Auditor'],
  CitaCreada: ['Recepcionista', 'Médico', 'Auditor'],
  CitaCancelada: ['Recepcionista', 'Médico', 'Auditor'],
  CitaReprogramada: ['Recepcionista', 'Médico', 'Auditor'],
  CitaExpirada: ['Recepcionista', 'Médico', 'Auditor'],
  IngresoRegistrado: ['Recepcionista', 'Médico', 'Auditor'],
  IngresoRevertido: ['Recepcionista', 'Médico', 'Auditor'],
  IngresoPagoVerificado: ['Recepcionista', 'Médico', 'Auditor'],
  IngresoPagoInconsistente: ['Recepcionista', 'Médico', 'Auditor'],
  // Sin GET dedicado — criterio propio: es un evento de auditoría de intentos
  // de reserva colisionados, no algo que un Médico necesite ver en vivo.
  IntentoReserva: ['Recepcionista', 'Auditor'],

  // pagos.routes.js:44 — GET /api/v2/pagos
  PagoConfirmado: ['Recepcionista', 'Auditor'],
  PagoAprobado: ['Recepcionista', 'Auditor'],
  PagoReversado: ['Recepcionista', 'Auditor'],
  PagoCoberturaVerificada: ['Recepcionista', 'Auditor'],
  PagoCoberturaInconsistente: ['Recepcionista', 'Auditor'],

  // seguros.routes.js:94 — GET /api/v2/coberturas
  CoberturaValidada: ['Recepcionista', 'Auditor'],
  CoberturaRechazada: ['Recepcionista', 'Auditor'],
  CoberturaPendiente: ['Recepcionista', 'Auditor'],

  // pacientes.routes.js:45 — GET /api/v2/pacientes
  PacienteRegistrado: ['Recepcionista', 'Auditor', 'Médico'],
  PacienteActualizado: ['Recepcionista', 'Auditor', 'Médico'],
  DatosContactoActualizados: ['Recepcionista', 'Auditor', 'Médico'],
  EstadoPacienteActualizado: ['Recepcionista', 'Auditor', 'Médico'],

  // facturacion.routes.js:38/60 — GET /api/v2/facturacion/...
  ComprobanteGenerado: ['Recepcionista', 'Auditor'],
  ComprobanteEmitido: ['Recepcionista', 'Auditor'],
  ComprobanteNombreVerificado: ['Recepcionista', 'Auditor'],

  // historiaClinica.routes.js:95/125 — sin Recepcionista, a diferencia de los demás módulos
  ExpedienteCreado: ['Médico', 'Auditor'],
  EncuentroRegistrado: ['Médico', 'Auditor'],
  EncuentroClinicoRegistrado: ['Médico', 'Auditor'],
  PrescripcionEmitida: ['Médico', 'Auditor'],
  CitaCompletadaReconciliada: ['Médico', 'Auditor'],
  CitaCompletadaInconsistente: ['Médico', 'Auditor'],

  // prescripciones.routes.js:138 — GET /api/v2/prescripciones
  RecetaEmitida: ['Médico', 'Recepcionista', 'Auditor'],
  RecetaRetirada: ['Médico', 'Recepcionista', 'Auditor'],
  RecetaRechazada: ['Médico', 'Recepcionista', 'Auditor'],
  RecetaDespachada: ['Médico', 'Recepcionista', 'Auditor'],
  RecetaContingenciaGenerada: ['Médico', 'Recepcionista', 'Auditor'],
  RecetaPDFDisponible: ['Médico', 'Recepcionista', 'Auditor'],

  // medicos.routes.js:36 — GET /api/v2/medicos
  MedicoActualizado: ['Recepcionista', 'Médico', 'Auditor'],
  BloqueoRegistrado: ['Recepcionista', 'Médico', 'Auditor'],
  PlantillaHorarioActualizada: ['Recepcionista', 'Médico', 'Auditor'],
  HorarioSemanaDefinido: ['Recepcionista', 'Médico', 'Auditor'],

  // auth.routes.js:172 — GET /api/v2/auth/usuarios
  UsuarioRegistrado: ['Auditor', 'Médico', 'Recepcionista'],
  UsuarioActualizado: ['Auditor', 'Médico', 'Recepcionista'],
  // Puramente de auditoría (auth.usecases.js) — ningún GET propio, nadie más
  // necesita enterarse en vivo de que alguien inició sesión.
  UsuarioLoggedIn: ['Auditor'],

  // notificaciones.routes.js:64 — GET /api/v2/notificaciones (admin, solo Auditor)
  SMSEnviado: ['Auditor'],

  // Eventos operativos (circuitBreaker.js, serviceSwitch.js) — información de
  // salud del sistema, no dato de negocio con restricción de confidencialidad.
  // Van a los 3 roles de negocio por igual, sin tabla de roles por servicio.
  CircuitBreakerAbierto: ['Recepcionista', 'Médico', 'Auditor'],
  CircuitBreakerCerrado: ['Recepcionista', 'Médico', 'Auditor'],
  ServicioDeshabilitado: ['Recepcionista', 'Médico', 'Auditor'],
  ServicioHabilitado: ['Recepcionista', 'Médico', 'Auditor'],
};

const ROLES_DEFAULT_NO_MAPEADO = ['Auditor'];
const tiposYaAdvertidos = new Set();

// Fail-safe-pero-ruidoso: un tipo de evento nuevo que alguien olvide agregar
// aquí arriba nunca queda sin dueño (no se manda a todos, como antes) ni se
// pierde en silencio — cae a Auditor y se loguea UNA vez por tipo.
function rolesPermitidos(tipoEvento) {
  const roles = MAPA_ROLES_POR_EVENTO[tipoEvento];
  if (roles) return roles;

  if (!tiposYaAdvertidos.has(tipoEvento)) {
    tiposYaAdvertidos.add(tipoEvento);
    logger.warn(
      { tipoEvento, rolesDefault: ROLES_DEFAULT_NO_MAPEADO },
      `[Realtime] Tipo de evento sin roles mapeados en realtime.routing.js — usando default. Agregarlo a MAPA_ROLES_POR_EVENTO.`,
    );
  }
  return ROLES_DEFAULT_NO_MAPEADO;
}

module.exports = { rolesPermitidos };
