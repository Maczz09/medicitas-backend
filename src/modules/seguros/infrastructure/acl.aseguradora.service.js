class AseguradoraACLService {
  async validarPolizaExterna(aseguradora, numeroPoliza) {
    // Simulamos latencia de red (500ms - 1500ms)
    const latencia = Math.floor(Math.random() * 1000) + 500;
    await new Promise(resolve => setTimeout(resolve, latencia));

    // Lógica simulada: Si la póliza termina en '99', es rechazada.
    if (numeroPoliza.endsWith('99')) {
      return {
        aprobado: false,
        motivo: 'Póliza inactiva o cancelada',
        porcentajeCobertura: 0,
        codigoAutorizacion: null
      };
    }

    // Cobertura aleatoria entre 50% y 100% para casos aprobados
    const porcentajeAleatorio = Math.floor(Math.random() * 51) + 50; 

    return {
      aprobado: true,
      motivo: 'Cobertura activa',
      porcentajeCobertura: porcentajeAleatorio,
      codigoAutorizacion: `AUTH-${Date.now()}`
    };
  }
}

module.exports = AseguradoraACLService;
