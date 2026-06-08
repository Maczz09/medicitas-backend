class PasarelaPagosSimulada {
  async procesarCargo(tarjeta, monto) {
    const latencia = Math.floor(Math.random() * 1500) + 500;
    await new Promise(resolve => setTimeout(resolve, latencia));

    if (tarjeta.endsWith('0000')) {
      return {
        aprobado: false,
        motivo: 'Fondos insuficientes',
        codigoAutorizacion: null
      };
    }

    return {
      aprobado: true,
      motivo: 'Aprobado',
      codigoAutorizacion: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`
    };
  }
}

module.exports = PasarelaPagosSimulada;
