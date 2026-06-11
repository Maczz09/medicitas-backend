require('dotenv').config();
const app = require('./app');
const database = require('./config/database');
const redis = require('./config/redis');
const rabbitmq = require('./config/rabbitmq');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
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

    app.listen(PORT, () => {
      console.log(`[Servidor] Escuchando en el puerto ${PORT} - Entorno: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('[Bootstrap] Error crítico al iniciar:', err);
    process.exit(1);
  }
}

bootstrap();
