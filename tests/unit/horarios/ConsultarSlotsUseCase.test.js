const { ConsultarSlotsUseCase } = require('../../../src/modules/horarios/application/use-cases/ConsultarSlotsUseCase');
const { MedicoNoEncontradoError } = require('../../../src/modules/horarios/domain/horarios.errors');
const { Bloqueo } = require('../../../src/modules/horarios/domain/entities/Bloqueo');

const FECHA = '2026-07-08'; // miércoles

function armarUseCase({
  medicoExiste = true,
  horario = { horaInicio: '09:00', horaFin: '11:00', duracionCitaMin: 30, origen: 'PLANTILLA' },
  bloqueos = [],
  ocupadas = [],
} = {}) {
  return new ConsultarSlotsUseCase({
    medicoValidatorPort: { existeMedicoActivo: jest.fn().mockResolvedValue(medicoExiste) },
    resolverHorarioEfectivoUseCase: { ejecutar: jest.fn().mockResolvedValue(horario) },
    horariosRepository: { findBloqueosEnFecha: jest.fn().mockResolvedValue(bloqueos) },
    ocupacionCitasPort: { obtenerHorasOcupadas: jest.fn().mockResolvedValue(ocupadas) },
  });
}

describe('ConsultarSlotsUseCase — cálculo de slots del día', () => {
  test('médico inexistente lanza MedicoNoEncontradoError', async () => {
    const useCase = armarUseCase({ medicoExiste: false });
    await expect(useCase.ejecutar('MED-X', FECHA)).rejects.toThrow(MedicoNoEncontradoError);
  });

  test('sin horario ese día: tieneHorario=false y cero slots', async () => {
    const useCase = armarUseCase({ horario: null });
    const r = await useCase.ejecutar('MED-1', FECHA);
    expect(r.tieneHorario).toBe(false);
    expect(r.horario).toBeNull();
    expect(r.slots).toEqual([]);
  });

  test('genera un slot cada duracionCitaMin entre horaInicio y horaFin', async () => {
    const useCase = armarUseCase();
    const r = await useCase.ejecutar('MED-1', FECHA);

    expect(r.tieneHorario).toBe(true);
    expect(r.slots.map((s) => s.hora)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(r.slots.every((s) => s.estado === 'libre')).toBe(true);
    // Contrato público del endpoint: horario en snake_case
    expect(r.horario).toEqual({ hora_inicio: '09:00', hora_fin: '11:00', duracion_cita_min: 30 });
  });

  test('marca bloqueado / ocupado / libre según bloqueos y citas', async () => {
    const bloqueo = new Bloqueo({
      idBloqueo: 'BLQ-1',
      idMedico: 'MED-1',
      fechaInicio: `${FECHA}T09:30:00`,
      fechaFin: `${FECHA}T10:00:00`,
      motivo: 'Reunión clínica',
    });
    const useCase = armarUseCase({
      bloqueos: [bloqueo],
      ocupadas: [{ hora: '10:30', pacienteNombre: 'Juan Pérez' }],
    });

    const r = await useCase.ejecutar('MED-1', FECHA);
    const porHora = Object.fromEntries(r.slots.map((s) => [s.hora, s]));

    expect(porHora['09:00'].estado).toBe('libre');
    expect(porHora['09:30'].estado).toBe('bloqueado');
    expect(porHora['09:30'].motivoBloqueo).toBe('Reunión clínica');
    // El bloqueo termina exactamente a las 10:00 → ese slot NO está bloqueado
    expect(porHora['10:00'].estado).toBe('libre');
    expect(porHora['10:30'].estado).toBe('ocupado');
    expect(porHora['10:30'].paciente).toBe('Juan Pérez');
  });

  test('un bloqueo tiene prioridad sobre una cita en la misma hora', async () => {
    const bloqueo = new Bloqueo({
      idBloqueo: 'BLQ-1',
      idMedico: 'MED-1',
      fechaInicio: `${FECHA}T09:00:00`,
      fechaFin: `${FECHA}T11:00:00`,
    });
    const useCase = armarUseCase({
      bloqueos: [bloqueo],
      ocupadas: [{ hora: '09:30', pacienteNombre: 'Juan Pérez' }],
    });
    const r = await useCase.ejecutar('MED-1', FECHA);
    expect(r.slots.every((s) => s.estado === 'bloqueado')).toBe(true);
    expect(r.slots.every((s) => s.paciente === null)).toBe(true);
  });
});
