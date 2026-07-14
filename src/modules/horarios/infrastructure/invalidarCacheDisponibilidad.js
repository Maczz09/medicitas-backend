// Invalidación de la caché de disponibilidad de citas cuando cambia la agenda.
//
// BUG que esto corrige: el módulo citas valida las reservas contra
// `cache:disponibilidad:<medico>:<fecha>` en Redis (TTL 300s, recalentada por
// cacheSyncJob cada 5 min). Al definir un horario/plantilla/bloqueo NUEVO, esa
// caché quedaba obsoleta hasta 5 minutos: las reservas se rechazaban con
// COLISION_HORARIO usando la agenda VIEJA (o peor, se aceptaban en horas recién
// bloqueadas). Cambió la agenda → se borra la caché de ese médico y la próxima
// reserva la reconstruye desde la BD real.
//
// Best-effort a propósito: si Redis no está, la reserva ya degrada a consultar
// el servicio de disponibilidad directo (ver DisponibilidadRedisCache), así que
// nunca debe romper la operación de agenda que la dispara.

const { client: redis } = require('../../../config/redis');

async function invalidarCacheDisponibilidad(idMedico) {
  try {
    if (!redis.isOpen) return;
    for await (const key of redis.scanIterator({
      MATCH: `cache:disponibilidad:${idMedico}:*`,
      COUNT: 100,
    })) {
      // node-redis v4 entrega claves sueltas; v5+ entrega lotes (array) —
      // del() acepta ambos.
      await redis.del(key);
    }
  } catch { /* best-effort: nunca romper la operación de agenda */ }
}

module.exports = { invalidarCacheDisponibilidad };
