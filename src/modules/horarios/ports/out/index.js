class IHorariosRepository {
  async findSemana(idMedico, semanaInicio) { throw new Error('No implementado'); } // -> HorarioSemana | null
  async findPlantillaDia(idMedico, diaSemana) { throw new Error('No implementado'); } // -> PlantillaHorario | null
  async findPlantillaCompleta(idMedico) { throw new Error('No implementado'); } // -> PlantillaHorario[]
  async findBloqueosEnFecha(idMedico, fecha) { throw new Error('No implementado'); } // -> Bloqueo[] (solapan con el día)
  async findBloqueosFuturos(idMedico) { throw new Error('No implementado'); } // -> Bloqueo[] (fecha_fin >= ahora)
  async reemplazarPlantilla(idMedico, plantilla, connection) { throw new Error('No implementado'); }
  async reemplazarSemana(horarioSemana, connection) { throw new Error('No implementado'); }
  async guardarBloqueo(bloqueo, connection) { throw new Error('No implementado'); }
}

class IEventPublisher {
  async publish(connection, nombreEvento, payload, correlationId) { throw new Error('No implementado'); }
}

// Cross-módulo: horarios necesita saber si un id_medico existe/está activo,
// sin conocer nada más del perfil del médico (eso lo sigue dueño el módulo
// medicos). Mismo patrón que IPacienteValidatorPort en citas/seguros.
class IMedicoValidatorPort {
  async existeMedicoActivo(idMedico) { throw new Error('No implementado'); }
}

// Cross-módulo en la otra dirección: para generar slots, horarios necesita
// saber qué horas del día ya tienen una cita activa — eso vive en `citas`.
// Antes esto era un db.query() crudo dentro de medicos.usecases.js; ahora es
// un puerto explícito e inyectado.
class IOcupacionCitasPort {
  async obtenerHorasOcupadas(idMedico, fecha) { throw new Error('No implementado'); } // -> [{hora:'HH:MM', pacienteNombre}]
}

module.exports = { IHorariosRepository, IEventPublisher, IMedicoValidatorPort, IOcupacionCitasPort };
