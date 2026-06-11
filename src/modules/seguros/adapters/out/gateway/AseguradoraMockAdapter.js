const logger = require('../../../../../shared/logger/logger');

class AseguradoraMockAdapter {
  async validarPoliza({ idPaciente, idAseguradora, numeroPoliza, tipoConsulta }) {
    logger.info({ idPaciente, idAseguradora, numeroPoliza, tipoConsulta },
      '[MOCK] Simulando validación de póliza con AseguradoraMockAdapter');

    // Simular latencia de red realista (100–300ms)
    await this._simularLatencia(100, 300);

    // ── Escenario: Timeout (para probar Circuit Breaker) ─────────────────────
    if (numeroPoliza.startsWith('P-TIMEOUT')) {
      await this._simularLatencia(8000, 10000); // Supera el CB_TIMEOUT_MS
      // Si llega aquí, el Circuit Breaker ya debería haber cortado
    }

    // ── Escenario: Error del servidor externo ─────────────────────────────────
    if (numeroPoliza.startsWith('P-ERROR')) {
      throw new Error('[MOCK] Aseguradora devolvió error 500 interno');
    }

    // ── Escenario: Póliza inválida o vencida ──────────────────────────────────
    if (numeroPoliza.startsWith('P-INVALIDA')) {
      return {
        estadoCobertura:     'RECHAZADA',
        porcentajeCobertura: 0,
        codigoAutorizacion:  null,
        vigencia:            null,
        motivoRechazo:       'Póliza vencida o no vigente para el tipo de consulta',
      };
    }

    // ── Escenario: Sin cobertura para este tipo de consulta ───────────────────
    if (numeroPoliza.startsWith('P-SIN-COB')) {
      return {
        estadoCobertura:     'RECHAZADA',
        porcentajeCobertura: 0,
        codigoAutorizacion:  null,
        vigencia:            null,
        motivoRechazo:       `Tipo de consulta '${tipoConsulta}' no cubierto por la póliza`,
      };
    }

    // ── Escenario: Cobertura del 50% ──────────────────────────────────────────
    if (numeroPoliza.startsWith('P-50COB')) {
      return {
        estadoCobertura:     'APROBADA',
        porcentajeCobertura: 50,
        codigoAutorizacion:  `AUT-MOCK-${Date.now()}`,
        vigencia:            '2026-12-31',
      };
    }

    // ── Escenario por defecto: APROBADA con 80% ───────────────────────────────
    return {
      estadoCobertura:     'APROBADA',
      porcentajeCobertura: 80,
      codigoAutorizacion:  `AUT-MOCK-${Date.now()}-${idPaciente.replace('PAC-', '')}`,
      vigencia:            '2026-12-31',
    };
  }

  _simularLatencia(minMs, maxMs) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { AseguradoraMockAdapter };
