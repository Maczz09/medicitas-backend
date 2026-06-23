/**
 * Test E2E real — Envía evento PrescripcionEmitida y verifica que MediCitas llama a farmacia-api real.
 * 
 * Escenarios cubiertos por este script:
 *   1. Medicamento normal → espera DESPACHADA (farmacia-api acepta)
 *   2. Medicamento con "SIN-STOCK" → espera RECHAZADA_POR_STOCK (negocio de farmacia)
 */
const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

const RABBITMQ_URL = 'amqp://medicitas_broker:broker_secret_medicitas@localhost:5672/medicitas';

async function enviarEvento(medicamento, label) {
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();

  const idEvento = uuidv4();
  const evento = {
    evento: 'PrescripcionEmitida',
    idEvento,
    correlationId: uuidv4(),
    payload: {
      idPrescripcionClinica: uuidv4(),
      idEncuentro: uuidv4(),
      idPaciente: uuidv4(),
      contenido: {
        medicamento,
        dosis: '500mg',
        cantidad: 14,
      },
    },
  };

  ch.publish('medicitas.events', 'event.PrescripcionEmitida', Buffer.from(JSON.stringify(evento)));
  console.log(`[${label}] Enviado → medicamento: "${medicamento}" | idEvento: ${idEvento}`);

  await new Promise(r => setTimeout(r, 500));
  await conn.close();
  return idEvento;
}

async function main() {
  console.log('\n=== TEST E2E: MediCitas ↔ farmacia-api (sin mocks) ===\n');

  // Escenario 1: Receta normal → debería resultar en DESPACHADA
  await enviarEvento('Paracetamol 500mg', 'ESCENARIO-1 (DESPACHADA esperada)');

  // Escenario 2: Sin stock → debería resultar en RECHAZADA_POR_STOCK  
  await enviarEvento('Ibuprofeno SIN-STOCK', 'ESCENARIO-2 (RECHAZADA_POR_STOCK esperada)');

  console.log('\n✅ Eventos enviados. Revisa los logs de medicitas_backend y la tabla svc_pre.despachos.');
  console.log('   docker logs medicitas_backend --tail 50');
  console.log('   docker exec -i medicitas_mysql mysql -u root -proot_secret_medicitas -e "SELECT id, estado, motivo_rechazo FROM svc_pre.despachos ORDER BY created_at DESC LIMIT 5;"\n');
}

main().catch(console.error);
