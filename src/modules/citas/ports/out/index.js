class ICitasRepository {
  async findById(id) { throw new Error('No implementado'); }
  async save(cita, connection) { throw new Error('No implementado'); }
  async update(cita, connection) { throw new Error('No implementado'); }
  async getPendientesAtrasadas(minutosAtraso) { throw new Error('No implementado'); } // Para Tolerance Worker
}

class IDisponibilidadCache {
  async verificarDisponibilidad(idMedico, fechaHora) { throw new Error('No implementado'); }
  async marcarOcupado(idMedico, fechaHora) { throw new Error('No implementado'); }
  async liberarSlot(idMedico, fechaHora) { throw new Error('No implementado'); }
  async refrescarDesdeServicio(idMedico, fecha, slots) { throw new Error('No implementado'); }
}

class IEventPublisher {
  async publish(connection, nombreEvento, payload, correlationId) { throw new Error('No implementado'); }
  async publishIndependiente(nombreEvento, payload, correlationId) { throw new Error('No implementado'); }
}

class IPacienteValidatorPort {
  async existePaciente(idPaciente) { throw new Error('No implementado'); }
}

class IMedicoDisponibilidadPort {
  async obtenerDisponibilidad(idMedico, fecha) { throw new Error('No implementado'); }
}

module.exports = { 
  ICitasRepository, 
  IDisponibilidadCache, 
  IEventPublisher, 
  IPacienteValidatorPort, 
  IMedicoDisponibilidadPort 
};
