const { IDisponibilidadCache } = require('../../../ports/out');
const { client: redis } = require('../../../../../config/redis');

class DisponibilidadRedisCache extends IDisponibilidadCache {
  constructor(medicoDisponibilidadAdapter) {
    super();
    this.redis = redis;
    this.medicoAdapter = medicoDisponibilidadAdapter;
    this.TTL = parseInt(process.env.REDIS_CACHE_TTL_SEGUNDOS || '300');
  }

  async verificarDisponibilidad(idMedico, fechaHora) {
    const fecha = fechaHora.toISOString().split('T')[0];
    const hora  = fechaHora.toISOString().split('T')[1].slice(0, 5);
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
    const fecha = fechaHora.toISOString().split('T')[0];
    const hora  = fechaHora.toISOString().split('T')[1].slice(0, 5);
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
    const fecha = fechaHora.toISOString().split('T')[0];
    const hora  = fechaHora.toISOString().split('T')[1].slice(0, 5);
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
