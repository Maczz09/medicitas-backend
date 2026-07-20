const cron = require('node-cron');
const { MedicoDisponibilidadDBAdapter } = require('../adapters/out/http/MedicoDisponibilidadDBAdapter');
const { DisponibilidadRedisCache } = require('../adapters/out/cache/DisponibilidadRedisCache');
const db = require('../../../config/database');

const medicoAdapter = new MedicoDisponibilidadDBAdapter();
const cacheAdapter = new DisponibilidadRedisCache(medicoAdapter);

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Pre-calienta el cache de disponibilidad con los horarios reales de la BD
cron.schedule('*/5 * * * *', async () => {
  try {
    const [medicos] = await db.query(`SELECT id_medico FROM svc_med.medicos WHERE activo = 1`);
    if (!medicos.length) return;

    const hoy    = new Date();
    const manana = new Date(hoy);
    manana.setDate(hoy.getDate() + 1);
    const fechas = [localDateStr(hoy), localDateStr(manana)];

    for (const { id_medico } of medicos) {
      for (const fecha of fechas) {
        const slots = await medicoAdapter.obtenerDisponibilidad(id_medico, fecha);
        if (slots && slots.length > 0) {
          await cacheAdapter.refrescarDesdeServicio(id_medico, fecha, slots);
        }
      }
    }

    console.log('[CacheSyncJob] Caché de disponibilidad sincronizada.');
  } catch (error) {
    console.error('[CacheSyncJob] Error sincronizando caché:', error);
  }
});

console.log('[CacheSyncJob] Iniciado (Módulo Citas).');
