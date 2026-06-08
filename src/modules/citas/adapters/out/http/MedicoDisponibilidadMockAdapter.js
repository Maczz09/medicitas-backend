const { IMedicoDisponibilidadPort } = require('../../../ports/out');

class MedicoDisponibilidadMockAdapter extends IMedicoDisponibilidadPort {
  async obtenerDisponibilidad(idMedico, fecha) {
    // Este es un Mock. En un futuro módulo SVC-MED-006 se implementará un HTTP client real.
    // Retorna slots cada 30 minutos desde 08:00 hasta 18:00
    const slots = [];
    let hora = 8;
    let minutos = 0;

    for (let i = 0; i < 20; i++) { // 10 horas * 2 slots/hora
      const horaStr = hora.toString().padStart(2, '0');
      const minStr = minutos === 0 ? '00' : '30';
      
      const horaFin = minutos === 30 ? hora + 1 : hora;
      const minFinStr = minutos === 30 ? '00' : '30';
      const horaFinStr = horaFin.toString().padStart(2, '0');

      slots.push({
        horaInicio: `${horaStr}:${minStr}`,
        horaFin: `${horaFinStr}:${minFinStr}`,
        disponible: true // Asume disponible por defecto en el mock
      });

      if (minutos === 0) {
        minutos = 30;
      } else {
        minutos = 0;
        hora++;
      }
    }

    return slots;
  }
}

module.exports = { MedicoDisponibilidadMockAdapter };
