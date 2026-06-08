const cron = require('node-cron');
const { MedicoDisponibilidadMockAdapter } = require('../adapters/out/http/MedicoDisponibilidadMockAdapter');
const { DisponibilidadRedisCache } = require('../adapters/out/cache/DisponibilidadRedisCache');

const medicoAdapter = new MedicoDisponibilidadMockAdapter();
const cacheAdapter = new DisponibilidadRedisCache(medicoAdapter);

// Cache Sync Job: Se ejecuta cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
  try {
    // NOTA: Como aún no existe un servicio real de Médicos (SVC-MED-006) ni una base de
    // datos centralizada de médicos para iterar, en este mock simularemos la sincronización
    // para un ID de médico de prueba (o una lista ficticia).
    
    const medicosMock = ['MED-10294', 'MED-99999'];
    const hoy = new Date();
    const manana = new Date();
    manana.setDate(hoy.getDate() + 1);
    
    const fechas = [
      hoy.toISOString().split('T')[0],
      manana.toISOString().split('T')[0]
    ];

    for (const idMedico of medicosMock) {
      for (const fecha of fechas) {
        const slots = await medicoAdapter.obtenerDisponibilidad(idMedico, fecha);
        if (slots && slots.length > 0) {
          await cacheAdapter.refrescarDesdeServicio(idMedico, fecha, slots);
        }
      }
    }
    
    console.log('[CacheSyncJob] Sincronización de caché de disponibilidad completada.');
  } catch (error) {
    console.error('[CacheSyncJob] Error sincronizando caché:', error);
  }
});

console.log('[CacheSyncJob] Iniciado (Módulo Citas).');
