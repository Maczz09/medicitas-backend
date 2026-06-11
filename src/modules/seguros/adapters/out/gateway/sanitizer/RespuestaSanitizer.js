const ESTADOS_VALIDOS = Object.freeze(['APROBADA', 'RECHAZADA', 'PENDIENTE']);
const CODIGO_REGEX    = /^[A-Za-z0-9\-\.]{1,50}$/; // Solo alfanumérico, guiones y puntos
const FECHA_REGEX     = /^\d{4}-\d{2}-\d{2}$/;     // Solo YYYY-MM-DD

class RespuestaSanitizer {
  static sanitizar(respuestaExterna) {
    if (!respuestaExterna || typeof respuestaExterna !== 'object') {
      // La API devolvió algo que no es un objeto — fallo silencioso y seguro
      return {
        estadoCobertura:     'RECHAZADA',
        porcentajeCobertura: 0,
        codigoAutorizacion:  null,
        vigencia:            null,
      };
    }

    return {
      estadoCobertura:     RespuestaSanitizer._sanitizarEstado(respuestaExterna.estadoCobertura),
      porcentajeCobertura: RespuestaSanitizer._sanitizarPorcentaje(respuestaExterna.porcentajeCobertura),
      codigoAutorizacion:  RespuestaSanitizer._sanitizarCodigo(respuestaExterna.codigoAutorizacion),
      vigencia:            RespuestaSanitizer._sanitizarFecha(respuestaExterna.vigencia),
      // esFallback no viene de la API externa; lo agrega el fallback del CB
      esFallback:          respuestaExterna.esFallback === true,
      // Todo campo desconocido de la API externa queda FUERA aquí — nunca se propaga
    };
  }

  static _sanitizarEstado(estado) {
    if (typeof estado !== 'string') return 'RECHAZADA';
    const normalizado = estado.trim().toUpperCase();
    // Si el estado externo no es reconocido → fall-safe a RECHAZADA
    return ESTADOS_VALIDOS.includes(normalizado) ? normalizado : 'RECHAZADA';
  }

  static _sanitizarPorcentaje(porcentaje) {
    const numero = parseFloat(porcentaje);
    if (isNaN(numero) || numero < 0 || numero > 100) return 0;
    // Redondear a 2 decimales para evitar problemas de precisión flotante
    return Math.round(numero * 100) / 100;
  }

  static _sanitizarCodigo(codigo) {
    if (!codigo || typeof codigo !== 'string') return null;
    const limpio = codigo.trim();
    // Rechazar si tiene caracteres no permitidos
    if (!CODIGO_REGEX.test(limpio)) return null;
    return limpio;
  }

  static _sanitizarFecha(fecha) {
    if (!fecha || typeof fecha !== 'string') return null;
    const limpia = fecha.trim().slice(0, 10); // Solo los primeros 10 caracteres
    if (!FECHA_REGEX.test(limpia)) return null;
    const date = new Date(limpia);
    if (isNaN(date.getTime())) return null;
    return limpia;
  }
}

module.exports = { RespuestaSanitizer };
