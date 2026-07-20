const { conReintentos } = require('../../../../../shared/resilience/retryConBackoffJitter');
const { crearCircuitBreaker } = require('../../../../../shared/resilience/circuitBreaker');
const { crearClienteInterno } = require('../../../../../shared/resilience/clienteHttpInterno');
const { obtenerTimeoutPdfParaIntento, CB_TIMEOUT_MS_PDF } = require('../../../../../shared/resilience/config');
const { crearErrorDependencia } = require('../../../../../shared/resilience/erroresResiliencia');
const logger = require('../../../../../shared/logger/logger');

const NOMBRE_SERVICIO = 'Notificaciones→Documentos';

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
//
// Timeout: horario PROPIO más alto que el genérico (5s/10s/15s en vez de
// 2s/4s/8s — ver shared/resilience/config.js#PDF_TIMEOUT_SCHEDULE_MS),
// porque generar+servir un PDF puede tardar genuinamente más que un lookup
// JSON. Con el horario genérico, una descarga de ~10s agotaba los 3
// intentos (2s+4s+8s) y fallaba — con este horario tiene margen real,
// terminando en el mismo techo (15s) que el timeout fijo de antes de esta
// migración. El CB de este adaptador también usa su propio timeout interno
// (CB_TIMEOUT_MS_PDF) para no cortar antes de que axios llegue a intentarlo.
class DocumentoHttpAdapter {
  constructor() {
    this.cliente = crearClienteInterno({ baseUrl: INTERNAL_BASE_URL });

    const { breaker } = crearCircuitBreaker({
      nombreServicio: NOMBRE_SERVICIO,
      servicioAfectado: 'Documentos',
      accion: this._descargar.bind(this),
      cbTimeoutMs: CB_TIMEOUT_MS_PDF,
    });
    this.breaker = breaker;
  }

  // `intento` (1-based) lo reenvía opossum desde breaker.fire(urlInterna, intento).
  async _descargar(urlInterna, intento) {
    return this.cliente.get(urlInterna, {
      responseType: 'arraybuffer',
      timeout: obtenerTimeoutPdfParaIntento(intento),
    });
  }

  async descargarBuffer(url) {
    const { pathname, search } = new URL(url);
    const urlInterna = `${pathname}${search}`;

    try {
      const { data } = await conReintentos(
        (intento) => this.breaker.fire(urlInterna, intento),
        { nombreServicio: NOMBRE_SERVICIO },
        logger,
      );
      return Buffer.from(data);
    } catch (error) {
      logger.error({ url: urlInterna, err: error.message, code: error.code }, '[Notificaciones→Documentos] Error al descargar el documento');
      throw crearErrorDependencia('Documentos', error);
    }
  }
}

module.exports = { DocumentoHttpAdapter };
