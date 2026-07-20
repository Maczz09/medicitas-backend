// DEBE ser el primer require: instala los hooks de auto-instrumentación antes
// de que cualquier módulo (express, mysql2, amqplib) sea cargado por primera vez.
require('./tracing');

require('dotenv').config();

// Red de seguridad global: whatsapp-web.js/Puppeteer tiene un race condition
// conocido ("ProtocolError: Execution context was destroyed") que lanza una
// promesa rechazada sin capturar durante Client.inject() — sin este handler,
// Node terminaba el proceso COMPLETO por un fallo interno de una sola
// dependencia opcional (WhatsApp), tumbando también la API HTTP y los
// consumers de RabbitMQ que no tienen nada que ver. Se loguea y se continúa;
// WhatsappWebJSAdapter ya maneja su propio reintento de conexión.
process.on('unhandledRejection', (reason) => {
  const logger = require('./shared/logger/logger');
  logger.error({ err: reason?.message || reason, stack: reason?.stack },
    '[Proceso] unhandledRejection — el servidor sigue activo');
});
process.on('uncaughtException', (err) => {
  const logger = require('./shared/logger/logger');
  logger.error({ err: err.message, stack: err.stack },
    '[Proceso] uncaughtException — el servidor sigue activo');
});

const cluster = require('cluster');
const app = require('./app');
const database = require('./config/database');
const redis = require('./config/redis');
const rabbitmq = require('./config/rabbitmq');

const PORT = process.env.PORT || 3000;

// Métricas en :9091 para Prometheus. Dos casos:
//   - Modo NORMAL (proceso único): se arranca el servidor local aquí.
//   - Modo CLUSTER: el PRIMARY expone el servidor AGREGADO (ver cluster.js); cada
//     WORKER solo registra su listener IPC para responderle con sus métricas.
if (process.env.CLUSTER_MODE !== 'true') {
  try {
    require('./config/metricsServer').startLocal();
  } catch (err) {
    console.error('[Servidor] No se pudo iniciar el servidor de métricas local:', err.message);
  }
} else if (cluster.isWorker) {
  try {
    require('./config/metricsServer').registerWorker();
  } catch (err) {
    console.error('[Servidor] No se pudo registrar el worker para métricas:', err.message);
  }
}

// Con CLUSTERING, el HTTP corre en TODOS los workers, pero el trabajo de fondo
// (consumers de RabbitMQ, WhatsApp, realtime SSE, recovery de farmacia) debe
// correr en UN SOLO worker — si no, se procesarían los eventos N veces y se
// levantarían N instancias de Chromium. Se designa al worker #1.
// Sin cluster (producción normal o modo 1-proceso) este proceso corre el fondo.
function deboCorrerBackground() {
  if (process.env.CLUSTER_MODE !== 'true') return true;
  return !!(cluster.worker && cluster.worker.id === 1);
}

// Reintentos con backoff exponencial + jitter para las conexiones de ARRANQUE.
//
// Por qué existe: `depends_on: condition: service_healthy` solo lo respeta
// `docker compose up`. Ante un reinicio del HOST o de Docker Desktop, los
// contenedores los levanta su restart policy TODOS a la vez y ese orden se
// pierde. El backend le ganaba la carrera a RabbitMQ, recibía ECONNREFUSED en
// :5672, y el bootstrap se rendía al PRIMER intento. Con NODE_ENV=development
// eso no mata el proceso: la API seguía respondiendo 200 y /health en verde,
// pero SIN un solo consumer registrado. Resultado verificado en vivo: las colas
// acumulando mensajes con `consumers=0` (q.auditoria con 11 encolados) y ningún
// comprobante, notificación ni despacho de receta generándose — un sistema que
// parece sano y no procesa nada. El fallo más caro es el que no se ve.
//
// Reintentar convierte esa carrera de arranque en un retraso de segundos. Es el
// mismo patrón que workers/outbox.worker.js ya usaba (conectarConReintentos);
// el bootstrap del backend era el único camino que no lo tenía.
// Nombre distinto a propósito de conReintentos en shared/resilience/
// retryConBackoffJitter.js — son funciones NO relacionadas (esta es solo
// para el arranque: MySQL/Redis/RabbitMQ), pero compartían nombre y un
// `grep conReintentos` las confundía.
async function esperarConReintentos(nombre, fn, maxIntentos = 20, baseMs = 1000) {
  const logger = require('./shared/logger/logger');
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await fn();
    } catch (err) {
      if (intento === maxIntentos) throw err;
      // Jitter: si varios workers del cluster reintentan a la vez, evita que
      // golpeen la dependencia en manada justo cuando está arrancando.
      const backoff = Math.min(baseMs * 2 ** (intento - 1), 15000);
      const espera = Math.round(backoff * (0.5 + Math.random() / 2));
      logger.warn(
        { dependencia: nombre, intento, maxIntentos, esperaMs: espera, err: err.message },
        `[Bootstrap] ${nombre} no disponible (intento ${intento}/${maxIntentos}) — reintentando en ${espera}ms`,
      );
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

async function bootstrap() {
  // El servidor HTTP arranca primero para que /metrics y /api-docs
  // estén disponibles incluso si la infra aún no está lista
  await new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`[Servidor] Escuchando en el puerto ${PORT} - Entorno: ${process.env.NODE_ENV}`);
      resolve();
    });
  });

  try {
    await esperarConReintentos('MySQL', () => database.query('SELECT 1'));
    console.log('[MySQL] Conectado exitosamente');

    await esperarConReintentos('Redis', () => redis.connect());

    // Kill-switch sincronizado entre workers vía Redis — necesario en TODOS
    // los workers para que un PATCH a /admin/servicios los afecte a todos.
    await require('./shared/infrastructure/serviceSwitch').init();

    // RabbitMQ: TODOS los workers se conectan (antes: solo el worker de
    // fondo). El punto exacto donde se perdían los consumers: RabbitMQ tarda
    // más en aceptar conexiones que MySQL/Redis, así que es el que pierde la
    // carrera.
    await esperarConReintentos('RabbitMQ', () => rabbitmq.connect());

    // Setup Realtime SSE Broadcaster — TODOS los workers, no solo el de
    // fondo. Cada worker de cluster es un proceso separado con su PROPIO
    // clients[] en memoria (Node cachea módulos por proceso): un cliente SSE
    // enrutado a cualquier worker que no fuera el #1 nunca veía un evento
    // real, solo pings (mismo patrón que un bug ya arreglado para métricas
    // Prometheus, ver docs/MEJORAS.md). Cada worker crea su PROPIA cola
    // exclusiva — el exchange topic entrega una copia a cada cola bindeada,
    // así que todos reciben todo sin competir entre sí ni con q.auditoria
    // (esa sí es compartida — un mensaje va a un solo consumidor, no serviría
    // para esto).
    const { broadcastEvent } = require('./shared/infrastructure/realtime.routes');
    const crypto = require('crypto');
    async function suscribirColaRealtime(channel) {
      const realtimeQueueName = `q.realtime.${crypto.randomUUID()}`;
      await channel.assertQueue(realtimeQueueName, { exclusive: true, autoDelete: true });
      await channel.bindQueue(realtimeQueueName, 'medicitas.events', '#');
      await channel.consume(realtimeQueueName, (msg) => {
        if (msg !== null) {
          try {
            const payload = JSON.parse(msg.content.toString());
            broadcastEvent(payload.evento || msg.fields.routingKey, payload);
          } catch (e) {
            console.error('[Realtime] Error parsing message', e);
          }
          channel.ack(msg);
        }
      });
    }
    await suscribirColaRealtime(rabbitmq.getChannel());

    // Re-suscripción de la cola realtime tras una reconexión de RabbitMQ, en
    // TODOS los workers — independiente del re-enganche de los consumers de
    // negocio (que sigue restringido al worker de fondo, ver más abajo).
    rabbitmq.registrarOnReconnect(async (canalNuevo) => {
      const logger = require('./shared/logger/logger');
      try {
        await suscribirColaRealtime(canalNuevo);
        logger.info('[RabbitMQ] Canal realtime (SSE) re-suscrito tras la reconexión');
      } catch (err) {
        logger.error({ err: err.message }, `[RabbitMQ] No se pudo re-suscribir el canal realtime: ${err.message}`);
      }
    });

    // ─── Trabajo de fondo (consumers de negocio, WhatsApp, recovery) ────────
    // Solo el worker designado. El resto de workers sirven HTTP + realtime
    // SSE (arriba) y ya tienen MySQL + Redis + RabbitMQ, que es todo lo que
    // el request path necesita (los eventos se escriben a la tabla outbox,
    // no a RabbitMQ directo). Si este bloque corriera en más de un worker,
    // se procesarían los eventos N veces y se levantarían N instancias de
    // Chromium.
    if (deboCorrerBackground()) {

    // Wiring de dependencias del consumer de Facturación
    const { FacturacionConsumer } = require('./modules/facturacion/consumer/facturacion.consumer');
    const { GenerarComprobanteUseCase } = require('./modules/facturacion/application/use-cases/GenerarComprobanteUseCase');
    const { ComprobantesMySQLRepository } = require('./modules/facturacion/adapters/out/repositories/ComprobantesMySQLRepository');
    const { SeriesMySQLRepository } = require('./modules/facturacion/adapters/out/repositories/SeriesMySQLRepository');
    const { PDFKitGenerator } = require('./modules/facturacion/adapters/out/pdf/PDFKitGenerator');
    const { PacienteHttpAdapter } = require('./modules/facturacion/adapters/out/http/PacienteHttpAdapter');
    const { OutboxMySQLPublisher } = require('./modules/facturacion/adapters/out/events/OutboxMySQLPublisher');
    
    const comprobantesRepo = new ComprobantesMySQLRepository(database);
    const seriesRepo       = new SeriesMySQLRepository();
    const pdfGenerator     = new PDFKitGenerator();
    const pacienteAdp      = new PacienteHttpAdapter();
    const outbox           = new OutboxMySQLPublisher();
  
    const generarUseCase = new GenerarComprobanteUseCase({
      comprobantesRepository: comprobantesRepo,
      seriesRepository:       seriesRepo,
      pdfGenerator,
      pacienteDatos:          pacienteAdp,
      eventPublisher:         outbox,
      getConnection:          async () => await database.getConnection(),
    });
  
    const facturacionConsumer = new FacturacionConsumer(rabbitmq.getChannel(), generarUseCase);
    await facturacionConsumer.iniciar();

    // Wiring de dependencias del consumer de Auditoría
    const { AuditoriaConsumer }      = require('./modules/auditoria/consumer/auditoria.consumer');
    const { TrazasMySQLRepository }  = require('./modules/auditoria/adapters/out/repositories/TrazasMySQLRepository');
    const { RegistrarEventoUseCase } = require('./modules/auditoria/application/use-cases/RegistrarEventoUseCase');
    
    const trazasRepo = new TrazasMySQLRepository(database);
    const registrarEventoUseCase = new RegistrarEventoUseCase({ trazasRepository: trazasRepo });
    
    const auditoriaConsumer = new AuditoriaConsumer(rabbitmq.getChannel(), registrarEventoUseCase);
    await auditoriaConsumer.iniciar();

    // Wiring de dependencias del consumer de Notificaciones
    const { NotificacionesConsumer }     = require('./modules/notificaciones/consumer/notificaciones.consumer');
    const { MensajesSMSMySQLRepository } = require('./modules/notificaciones/adapters/out/repositories/MensajesSMSMySQLRepository');
    const { PacienteHttpAdapter: NotificacionesPacienteHttpAdapter }        = require('./modules/notificaciones/adapters/out/http/PacienteHttpAdapter');
    const { DocumentoHttpAdapter }        = require('./modules/notificaciones/adapters/out/http/DocumentoHttpAdapter');
    const { OutboxMySQLPublisher: NotificacionesOutboxMySQLPublisher }       = require('./modules/notificaciones/adapters/out/events/OutboxMySQLPublisher');
    const { WhatsappWebJSAdapter }       = require('./modules/notificaciones/adapters/out/gateway/WhatsappWebJSAdapter');
    const { SMSMockAdapter }             = require('./modules/notificaciones/adapters/out/gateway/SMSMockAdapter');
    const { NotificarPacienteUseCase }   = require('./modules/notificaciones/application/use-cases/NotificarPacienteUseCase');

    // Inicializar el use case de procesar pendientes (se dispara en onReady)
    const { ProcesarMensajesPendientesUseCase } = require('./modules/notificaciones/application/use-cases/ProcesarMensajesPendientesUseCase');
    
    let gateway;
    const procesarPendientesUseCase = new ProcesarMensajesPendientesUseCase({
      mensajesSMSRepository: new MensajesSMSMySQLRepository(database),
      getConnection: async () => await database.getConnection(),
      getGateway: () => gateway
    });

    gateway = process.env.USE_MOCK_SMS === 'true'
      ? new SMSMockAdapter()
      : new WhatsappWebJSAdapter(async () => {
          // Callback cuando WhatsApp Web está listo (vinculado)
          const logger = require('./shared/logger/logger');
          logger.info('[Notificaciones] WhatsApp vinculado. Procesando pendientes...');
          await procesarPendientesUseCase.ejecutar();
        });

    const useCase = new NotificarPacienteUseCase({
      mensajesSMSRepository: new MensajesSMSMySQLRepository(database),
      smsGateway:            gateway,
      pacienteTelefono:      new NotificacionesPacienteHttpAdapter(),
      eventPublisher:        new NotificacionesOutboxMySQLPublisher(),
      getConnection:         async () => await database.getConnection(),
      documentoDownloader:   new DocumentoHttpAdapter(),
    });

    const notificacionesConsumer = new NotificacionesConsumer(rabbitmq.getChannel(), useCase);
    await notificacionesConsumer.iniciar();

    // Wiring de dependencias del consumer de Prescripciones
    const { PrescripcionesConsumer } = require('./modules/prescripciones/consumer/prescripciones.consumer');
    const DespachosMySQLRepository = require('./modules/prescripciones/adapters/out/DespachosMySQLRepository');
    const OutboxEventPublisher = require('./modules/prescripciones/adapters/out/OutboxEventPublisher');
    const IniciarDespachoUseCase = require('./modules/prescripciones/application/use-cases/IniciarDespachoUseCase');
    const FarmaciaMockAdapter = require('./modules/prescripciones/adapters/out/gateway/FarmaciaMockAdapter');
    const FarmaciaAxiosAdapter = require('./modules/prescripciones/adapters/out/gateway/FarmaciaAxiosAdapter');

    // Receta en PDF (v2.1.0): en contingencia (CB abierto) Y en despacho exitoso
    const RecetasContingenciaMySQLRepository = require('./modules/prescripciones/adapters/out/RecetasContingenciaMySQLRepository');
    const { RecetaPDFGenerator } = require('./modules/prescripciones/adapters/out/pdf/RecetaPDFGenerator');
    const GenerarRecetaPDFUseCase = require('./modules/prescripciones/application/use-cases/GenerarRecetaPDFUseCase');

    // nombreServicio distinto del de prescripciones.routes.js (gateway) a
    // propósito: son 2 instancias con 2 circuit breakers independientes — ver
    // el comentario en FarmaciaAxiosAdapter sobre por qué NO pueden
    // compartir nombre en el gauge de Prometheus.
    const preGateway = process.env.USE_MOCK_FARMACIA === 'true'
      ? new FarmaciaMockAdapter()
      : new FarmaciaAxiosAdapter({ nombreServicio: 'FarmaciaAPI-Despacho' });

    const preEventPublisher = new OutboxEventPublisher();

    const generarRecetaPDFUseCase = new GenerarRecetaPDFUseCase({
      recetasContingenciaRepository: new RecetasContingenciaMySQLRepository(),
      pdfGenerator: new RecetaPDFGenerator(),
      eventPublisher: preEventPublisher,
      getConnection: async () => await database.getConnection(),
      logger: require('./shared/logger/logger'),
    });

    const iniciarDespachoUseCaseObj = new IniciarDespachoUseCase({
      despachosRepository: new DespachosMySQLRepository(),
      farmaciaGateway: preGateway,
      eventPublisher: preEventPublisher,
      getConnection: async () => await database.getConnection(),
      logger: require('./shared/logger/logger'),
      generarRecetaPDFUseCase,
    });

    const prescripcionesConsumer = new PrescripcionesConsumer(rabbitmq.getChannel(), iniciarDespachoUseCaseObj);
    await prescripcionesConsumer.iniciar();

    // ─── Re-enganche de consumers tras una reconexión de RabbitMQ ───────────
    // rabbitmq.js YA tenía toda la maquinaria: `connection.on('close')` dispara
    // _scheduleReconnect(), que reconecta con backoff y luego recorre los
    // callbacks de registrarOnReconnect() logueando "re-registrando
    // consumers...". El problema: NADIE se registraba nunca, así que ese bucle
    // iteraba sobre un array vacío y el log mentía.
    //
    // Consecuencia real (verificada en vivo tras matar RabbitMQ con el chaos
    // monkey): la conexión se restablecía y publishEvent volvía a funcionar,
    // pero cada consumer seguía aferrado al CANAL MUERTO con el que se
    // construyó. Los eventos se encolaban y nadie los procesaba — q.auditoria
    // acumulando mensajes con `consumers=0`, sin comprobantes, sin
    // notificaciones y sin despachos de recetas. La API respondía 200 todo el
    // tiempo, así que el fallo era invisible.
    //
    // Reasignar el canal nuevo y volver a llamar iniciar() vuelve a suscribir
    // (prefetch + consume). Si un consumer falla al re-suscribirse no se aborta
    // el resto: cada uno es independiente.
    rabbitmq.registrarOnReconnect(async (canalNuevo) => {
      const logger = require('./shared/logger/logger');
      const consumers = [
        ['facturacion',    facturacionConsumer],
        ['auditoria',      auditoriaConsumer],
        ['notificaciones', notificacionesConsumer],
        ['prescripciones', prescripcionesConsumer],
      ];
      for (const [nombre, consumer] of consumers) {
        try {
          consumer.channel = canalNuevo;
          await consumer.iniciar();
          logger.info({ consumer: nombre }, `[RabbitMQ] Consumer '${nombre}' re-suscrito tras la reconexión`);
        } catch (err) {
          logger.error(
            { consumer: nombre, err: err.message },
            `[RabbitMQ] No se pudo re-suscribir el consumer '${nombre}': ${err.message}`,
          );
        }
      }
      // La cola realtime NO se re-suscribe aquí: tiene su propio
      // registrarOnReconnect (arriba, fuera de deboCorrerBackground) porque
      // corre en TODOS los workers, no solo en el de fondo.
    });

    // Recovery Replay — se dispara cuando el CB de Farmacia cierra (servicio recuperado).
    // Busca despachos en RECHAZADA_POR_VALIDACION (fallback por caída de red/CB abierto,
    // no RECHAZADA_POR_STOCK que es decisión de negocio real) y los reintenta.
    // Máximo RECOVERY_LIMIT por evento de recuperación para no saturar farmacia-api recién levantada.
    const RECOVERY_LIMIT_FARMACIA = 20;
    const ReintentarEnvioUseCase = require('./modules/prescripciones/application/use-cases/ReintentarEnvioUseCase');
    const recoveryRepo = new DespachosMySQLRepository();
    const reintentarEnvioUseCase = new ReintentarEnvioUseCase({
      despachosRepository: recoveryRepo,
      iniciarDespachoUseCase: iniciarDespachoUseCaseObj,
      getConnection: async () => await database.getConnection(),
      logger: require('./shared/logger/logger'),
    });

    preGateway.registrarRecuperacion(async () => {
      const logger = require('./shared/logger/logger');
      const pendientes = await recoveryRepo.findByEstado('RECHAZADA_POR_VALIDACION', RECOVERY_LIMIT_FARMACIA, database);
      if (pendientes.length === 0) return;

      logger.info({ total: pendientes.length }, '[Farmacia] Recovery replay: reintentando despachos RECHAZADA_POR_VALIDACION');
      for (const d of pendientes) {
        await reintentarEnvioUseCase.ejecutar(d.id, d.correlationId)
          .catch((err) => logger.warn({ err: err.message, id: d.id }, '[Farmacia] Recovery replay: fallo individual — continúa con siguiente'));
      }
    });

    } // fin if(deboCorrerBackground())

  } catch (err) {
    // Con el logger (no console.error): esta línea salía como texto plano, así
    // que Promtail no la parseaba, se quedaba sin el label `app` y NO aparecía
    // al consultar {app="medicitas-backend"} en Grafana. El error que dejaba al
    // sistema sin consumers era justamente el que no se podía ver en Loki.
    const logger = require('./shared/logger/logger');
    logger.error(
      { err: err.message || String(err), fase: 'bootstrap' },
      `[Bootstrap] Error al conectar con la infraestructura tras agotar reintentos: ${err.message || err}`,
    );
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      // Se mantiene vivo a propósito (DX: permite trabajar la API sin infra),
      // pero se dice EXPLÍCITAMENTE qué queda roto. Antes decía solo "el
      // servidor sigue activo", que se leía como algo benigno: en realidad el
      // proceso sirve HTTP con /health en verde mientras NINGÚN evento se
      // consume y las colas crecen en silencio.
      logger.error(
        { fase: 'bootstrap', consumersActivos: false },
        '[Bootstrap] DEGRADADO: la API responde HTTP pero NO hay consumers. ' +
        'Los eventos se acumularán en RabbitMQ sin procesarse (no se generarán ' +
        'comprobantes, notificaciones ni despachos). Revisar la infra y reiniciar el backend.',
      );
    }
  }
}

bootstrap();
