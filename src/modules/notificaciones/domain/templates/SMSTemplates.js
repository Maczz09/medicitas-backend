// Helpers de formato
const _fecha = (iso) =>
  new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });

const _hora = (iso) =>
  new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: true });

// ── Plantillas por tipo de evento ─────────────────────────────────────────────
// Cada función recibe el payload del evento y retorna el texto del SMS.
// Máximo recomendado: 160 caracteres para un SMS de parte única.

const PLANTILLAS = Object.freeze({

  CitaCreada: ({ fechaHora, especialidad, pacienteNombre, medicoNombre }) =>
    `✅ Medicitas — Hola ${pacienteNombre || 'paciente'}, tu cita ha sido confirmada.\n` +
    `👨‍⚕️ ${medicoNombre || 'Médico asignado'} · ${especialidad}\n` +
    `📅 ${_fecha(fechaHora)} a las ${_hora(fechaHora)}\n` +
    `Te enviaremos un recordatorio 30 min antes. ¡Te esperamos!`,

  CitaCancelada: ({ fechaHora }) =>
    `MediCitas: Su cita del ${_fecha(fechaHora)} ha sido cancelada. Llámenos para reagendar.`,

  CitaReprogramada: ({ fechaNueva }) =>
    `MediCitas: Su cita fue reprogramada para el ${_fecha(fechaNueva)} a las ${_hora(fechaNueva)}.`,

  CitaExpirada: ({ fechaHoraCita }) =>
    `MediCitas: Su cita del ${_fecha(fechaHoraCita)} fue cancelada por inasistencia. Contáctenos para reagendar.`,

  AlertaRetraso: ({ minutoAlerta, minutosRestantes }) =>
    `MediCitas: Su cita ya comenzó hace ${minutoAlerta} min. Tiene ${minutosRestantes} min para presentarse.`,

  PagoAprobado: ({ montoCopago, tipoComprobante }) =>
    `MediCitas: Pago de S/ ${Number(montoCopago).toFixed(2)} confirmado. Su ${tipoComprobante?.toLowerCase() || 'comprobante'} será enviado pronto.`,

  ComprobanteEmitido: ({ tipo, numero, urlDescarga }) =>
    `MediCitas: Su ${tipo?.toLowerCase() || 'comprobante'} ${numero} listo. Descárgalo: ${urlDescarga}`,

});

// Tipos de evento que generan SMS — cualquier evento fuera de esta lista se ignora silenciosamente
const EVENTOS_NOTIFICABLES = Object.freeze(Object.keys(PLANTILLAS));

/**
 * Renderiza el texto del SMS para un evento dado.
 * @param {string} tipoEvento
 * @param {object} payload
 * @returns {string|null} texto del SMS o null si el evento no genera SMS
 */
function renderizar(tipoEvento, payload) {
  const plantilla = PLANTILLAS[tipoEvento];
  if (!plantilla) return null; // Evento válido pero que no genera SMS
  return plantilla(payload);
}

module.exports = { PLANTILLAS, EVENTOS_NOTIFICABLES, renderizar };
