const logger = require('../../../../../shared/logger/logger');

class FarmaciaMockAdapter {
  async enviarReceta({ idDespacho, idFarmacia, contenido }) {
    logger.info({ idDespacho, idFarmacia }, '[MOCK] Simulando envío de receta a FarmaciaMockAdapter');

    await this._simularLatencia(150, 400);

    const medicamento = (contenido?.medicamento || '').toUpperCase();

    if (medicamento.includes('TIMEOUT')) {
      await this._simularLatencia(8000, 10000); // Supera el CB_TIMEOUT_MS_FARMACIA
    }

    if (medicamento.includes('ERROR')) {
      throw new Error('[MOCK] Farmacia devolvió error 500 interno');
    }

    if (medicamento.includes('SIN-STOCK')) {
      return {
        estado: 'RECHAZADA',
        motivoRechazo: 'Stock insuficiente para el medicamento solicitado',
      };
    }

    return {
      estado: 'DESPACHADA',
      referenciaFarmacia: `FARM-REF-${Date.now()}`,
      observacionFarmacia: 'Receta validada y lista para entrega en mostrador',
    };
  }

  _simularLatencia(minMs, maxMs) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = FarmaciaMockAdapter;
