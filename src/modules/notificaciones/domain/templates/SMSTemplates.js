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

  CitaExpirada: ({ fechaHoraCita, minutosEsperados }) =>
    `MediCitas: Su cita del ${_fecha(fechaHoraCita)} fue cancelada por inasistencia al superar los ${minutosEsperados || 15} min de tolerancia. Contáctenos al +51 1 234-5678 para reagendar.`,

  Recordatorio30m: ({ fechaHora, especialidad, pacienteNombre, medicoNombre }) =>
    `📅 Recordatorio Medicitas — Hola ${pacienteNombre}, tienes una cita con ${medicoNombre} (${especialidad}) ` +
    `HOY ${_fecha(fechaHora)} a las ${_hora(fechaHora)}. ` +
    `Por favor llega con 10 minutos de anticipación y trae tu documento de identidad.`,

  // minutoAlerta/minutosRestantes llegan calculados desde el cron sobre la
  // ventana que corresponda (15 min anticipada / 20 min reserva "en la hora"),
  // así que el texto no puede fijar esos números — antes decía "15 minutos"
  // y comparaba minutoAlerta === 5/10 aunque el checkpoint real de una
  // reserva inmediata cae en 7/13, dejando el mensaje siempre en el genérico.
  AlertaRetraso: ({ minutoAlerta, minutosRestantes, pacienteNombre, medicoNombre, hora }) => {
    if (minutoAlerta === 0) {
      return `🔔 Medicitas — ${pacienteNombre}, tu cita con ${medicoNombre} acaba de comenzar a las ${hora}. Dirígete a la recepción de inmediato. Tienes ${minutosRestantes} minutos de tolerancia.`;
    }
    const limite = minutoAlerta + (minutosRestantes ?? 0);
    const esUltimoAviso = limite > 0 && minutosRestantes <= Math.round(limite / 3);
    if (esUltimoAviso) {
      return `⚠️ Medicitas — ${pacienteNombre}, ya van ${minutoAlerta} minutos desde tu cita con ${medicoNombre} (${hora}). Solo te quedan ${minutosRestantes} minutos antes de que sea marcada como NO ASISTIDA. Por favor, preséntate de inmediato.`;
    }
    return `⚠️ Medicitas — ${pacienteNombre}, han pasado ${minutoAlerta} minutos desde tu cita con ${medicoNombre} (${hora}). Tienes ${minutosRestantes} minutos más de tolerancia antes del cierre. ¡Date prisa!`;
  },

  PagoAprobado: ({ montoCopago, tipoComprobante }) =>
    `MediCitas: Pago de S/ ${Number(montoCopago).toFixed(2)} confirmado. Su ${tipoComprobante?.toLowerCase() || 'comprobante'} será enviado pronto.`,

  ComprobanteEmitido: ({ tipo, numero, urlDescarga }) =>
    `MediCitas: Su ${tipo?.toLowerCase() || 'comprobante'} ${numero} listo. Descárgalo: ${urlDescarga}`,

  RecetaContingenciaGenerada: ({ medicamento, urlDescarga }) =>
    `⚠️ MediCitas — Contingencia: no pudimos enviar tu receta a la farmacia automáticamente. ` +
    `Aquí tienes tu receta de ${medicamento || 'tu medicamento'} en PDF, preséntala en cualquier farmacia junto ` +
    `con tu documento de identidad: ${urlDescarga}`,

  RecetaPDFDisponible: ({ medicamento, urlDescarga }) =>
    `✅ MediCitas — Tu receta de ${medicamento || 'tu medicamento'} ya fue enviada a la farmacia. ` +
    `Aquí tienes una copia en PDF para tus registros: ${urlDescarga}`,

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
