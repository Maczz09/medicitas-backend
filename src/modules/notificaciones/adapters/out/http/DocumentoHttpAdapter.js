const axios = require('axios');
const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const logger = require('../../../../../shared/logger/logger');

const DESCARGA_TIMEOUT_MS = parseInt(process.env.NOT_PDF_DOWNLOAD_TIMEOUT_MS || '15000');
// La `urlDescarga` que traen los eventos apunta al host PÚBLICO (nginx en
// :80) para que el paciente la abra desde su navegador o WhatsApp — pero
// nginx es un contenedor aparte, no alcanzable como `localhost` desde
// DENTRO del contenedor del backend. Se descarta el host público y se
// conserva solo el path, llamando al backend por su URL interna (mismo
// patrón que PacienteHttpAdapter/APP_INTERNAL_BASE_URL).
const INTERNAL_BASE_URL = process.env.APP_INTERNAL_BASE_URL || 'http://localhost:3000';

// Descarga el PDF directamente al Buffer de Node (responseType arraybuffer)
// — el archivo nunca toca el disco del contenedor de notificaciones, sin
// importar qué módulo lo generó ni cómo lo sirve (facturacion/prescripciones
// son un detalle de implementación ajeno a este adaptador).
class DocumentoHttpAdapter {
  async descargarBuffer(url) {
    const { pathname, search } = new URL(url);
    const urlInterna = `${INTERNAL_BASE_URL}${pathname}${search}`;

    const { data } = await conReintentos(() => axios.get(urlInterna, {
      responseType: 'arraybuffer',
      timeout: DESCARGA_TIMEOUT_MS,
    }), {}, logger);

    return Buffer.from(data);
  }
}

module.exports = { DocumentoHttpAdapter };
