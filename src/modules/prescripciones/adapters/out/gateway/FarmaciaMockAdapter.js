const logger = require('../../../../../shared/logger/logger');

class FarmaciaMockAdapter {
  // Misma firma que FarmaciaAxiosAdapter — contrato del puerto IFarmaciaGateway:
  //   enviarReceta({ idReceta, farmaciaId, medicamento, dosis, cantidad })
  //   → { aceptada, referenciaFarmacia, motivoRechazo, origenFallo }
  async enviarReceta({ idReceta, farmaciaId, medicamento, dosis, cantidad }) {
    logger.info({ idReceta, farmaciaId }, '[MOCK] Simulando envío de receta a FarmaciaMockAdapter');

    await this._simularLatencia(150, 400);

    const med = (medicamento || '').toUpperCase();

    // Escenario: Timeout — supera CB_TIMEOUT_MS_FARMACIA (para probar Circuit Breaker)
    if (med.includes('TIMEOUT')) {
      await this._simularLatencia(8000, 10000);
    }

    // Escenario: Error 500 — cuenta como falla de disponibilidad en el CB
    if (med.includes('ERROR')) {
      throw new Error('[MOCK] Farmacia devolvió error 500 interno');
    }

    // Escenario: Error 400/401 — error de configuración (NO debe abrir el CB gracias a errorFilter)
    // Trigger: incluir 'CONFIG-ERROR' en el nombre del medicamento
    if (med.includes('CONFIG-ERROR')) {
      const err = new Error('[MOCK] Farmacia rechazó la request por datos de configuración inválidos (400)');
      err.esErrorDeConfiguracion = true;
      throw err;
    }

    // Escenario: Sin stock — rechazo de negocio (aceptada: false, origenFallo: 'NEGOCIO')
    if (med.includes('SIN-STOCK')) {
      return {
        aceptada: false,
        referenciaFarmacia: null,
        motivoRechazo: 'Stock insuficiente para el medicamento solicitado',
        origenFallo: 'NEGOCIO',
      };
    }

    // Escenario por defecto: receta aceptada
    return {
      aceptada: true,
      referenciaFarmacia: `FARM-MOCK-${Date.now()}`,
      motivoRechazo: null,
      origenFallo: null,
    };
  }

  // No-op: el mock no tiene Circuit Breaker, no hay nada que recuperar
  registrarRecuperacion(_fn) {}

  _simularLatencia(minMs, maxMs) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = FarmaciaMockAdapter;
