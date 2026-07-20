const { IDisponibilidadCache } = require('../../../ports/out');
const { client: redis } = require('../../../../../config/redis');

// Usa hora LOCAL del proceso (respeta TZ=America/Lima) para armar las cache keys
function _localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _localTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

class DisponibilidadRedisCache extends IDisponibilidadCache {
  constructor(medicoDisponibilidadAdapter) {
    super();
    this.redis = redis;
    this.medicoAdapter = medicoDisponibilidadAdapter;
    this.TTL = parseInt(process.env.REDIS_CACHE_TTL_SEGUNDOS || '300');
  }

  async verificarDisponibilidad(idMedico, fechaHora) {
    const fecha = _localDate(fechaHora);
    const hora  = _localTime(fechaHora);
    const key   = `cache:disponibilidad:${idMedico}:${fecha}`;

    const cached = await this.redis.get(key);
    if (!cached) {
      try {
        const slots = await this.medicoAdapter.obtenerDisponibilidad(idMedico, fecha);
        if (slots) {
          await this.redis.setEx(key, this.TTL, JSON.stringify(slots));
          return slots.some(s => s.horaInicio === hora && s.disponible);
        }
      } catch (err) {
        // Fallback optimista si no responde el servicio
      }
      return true; // El constraint en BD es la red de seguridad final
    }

    const slots = JSON.parse(cached);
    return slots.some(s => s.horaInicio === hora && s.disponible);
  }

  async marcarOcupado(idMedico, fechaHora) {
    const fecha = _localDate(fechaHora);
    const hora  = _localTime(fechaHora);
    const key   = `cache:disponibilidad:${idMedico}:${fecha}`;

    const cached = await this.redis.get(key);
    if (cached) {
      const slots = JSON.parse(cached);
      const updated = slots.map(s => {
        if (s.horaInicio === hora) s.disponible = false;
        return s;
      });
      await this.redis.setEx(key, this.TTL, JSON.stringify(updated));
    }
  }

  async liberarSlot(idMedico, fechaHora) {
    const fecha = _localDate(fechaHora);
    const hora  = _localTime(fechaHora);
    const key   = `cache:disponibilidad:${idMedico}:${fecha}`;

    const cached = await this.redis.get(key);
    if (cached) {
      const slots = JSON.parse(cached);
      const updated = slots.map(s => {
        if (s.horaInicio === hora) s.disponible = true;
        return s;
      });
      await this.redis.setEx(key, this.TTL, JSON.stringify(updated));
    }
  }

  async refrescarDesdeServicio(idMedico, fecha, slots) {
    const key = `cache:disponibilidad:${idMedico}:${fecha}`;
    await this.redis.setEx(key, this.TTL, JSON.stringify(slots));
  }
}

module.exports = { DisponibilidadRedisCache };
