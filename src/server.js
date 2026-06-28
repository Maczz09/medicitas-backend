require('dotenv').config();
const app = require('./app');
const database = require('./config/database');
const redis = require('./config/redis');
const rabbitmq = require('./config/rabbitmq');

const PORT = process.env.PORT || 3000;

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
    await database.query('SELECT 1');
    console.log('[MySQL] Conectado exitosamente');

    await redis.connect();
    await rabbitmq.connect();

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
    const { OutboxMySQLPublisher: NotificacionesOutboxMySQLPublisher }       = require('./modules/notificaciones/adapters/out/events/OutboxMySQLPublisher');
    const { TwilioWhatsAppAdapter }      = require('./modules/notificaciones/adapters/out/gateway/TwilioWhatsAppAdapter');
    const { SMSMockAdapter }             = require('./modules/notificaciones/adapters/out/gateway/SMSMockAdapter');
    const { NotificarPacienteUseCase }   = require('./modules/notificaciones/application/use-cases/NotificarPacienteUseCase');

    const gateway = process.env.USE_MOCK_SMS === 'true'
      ? new SMSMockAdapter()
      : new TwilioWhatsAppAdapter();

    const useCase = new NotificarPacienteUseCase({
      mensajesSMSRepository: new MensajesSMSMySQLRepository(database),
      smsGateway:            gateway,
      pacienteTelefono:      new NotificacionesPacienteHttpAdapter(),
      eventPublisher:        new NotificacionesOutboxMySQLPublisher(),
      getConnection:         async () => await database.getConnection(),
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

    const preGateway = process.env.USE_MOCK_FARMACIA === 'true'
      ? new FarmaciaMockAdapter()
      : new FarmaciaAxiosAdapter();

    const iniciarDespachoUseCaseObj = new IniciarDespachoUseCase({
      despachosRepository: new DespachosMySQLRepository(),
      farmaciaGateway: preGateway,
      eventPublisher: new OutboxEventPublisher(),
      getConnection: async () => await database.getConnection(),
      logger: require('./shared/logger/logger')
    });

    const prescripcionesConsumer = new PrescripcionesConsumer(rabbitmq.getChannel(), iniciarDespachoUseCaseObj);
    await prescripcionesConsumer.iniciar();

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

  } catch (err) {
    console.error('[Bootstrap] Error al conectar con la infraestructura:', err.message || err);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('[Bootstrap] Modo desarrollo: el servidor sigue activo sin infra. /metrics y /api-docs disponibles.');
    }
  }
}

bootstrap();
