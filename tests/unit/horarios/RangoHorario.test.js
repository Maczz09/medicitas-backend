const { RangoHorario } = require('../../../src/modules/horarios/domain/value-objects/RangoHorario');
const { RangoHorarioInvalidoError } = require('../../../src/modules/horarios/domain/horarios.errors');

describe('RangoHorario — value object', () => {
  test('acepta un rango válido y normaliza', () => {
    const r = new RangoHorario({ horaInicio: '09:00', horaFin: '13:00', duracionCitaMin: 30 });
    expect(r.horaInicio).toBe('09:00');
    expect(r.horaFin).toBe('13:00');
    expect(r.duracionCitaMin).toBe(30);
  });

  test('recorta "HH:MM:SS" de mysql2 (columnas TIME) a "HH:MM"', () => {
    const r = new RangoHorario({ horaInicio: '09:00:00', horaFin: '13:30:00', duracionCitaMin: 30 });
    expect(r.horaInicio).toBe('09:00');
    expect(r.horaFin).toBe('13:30');
  });

  test('duración por defecto es 30 min', () => {
    const r = new RangoHorario({ horaInicio: '09:00', horaFin: '13:00' });
    expect(r.duracionCitaMin).toBe(30);
  });

  test('rechaza horaFin <= horaInicio', () => {
    expect(() => new RangoHorario({ horaInicio: '13:00', horaFin: '09:00' })).toThrow(RangoHorarioInvalidoError);
    expect(() => new RangoHorario({ horaInicio: '09:00', horaFin: '09:00' })).toThrow(RangoHorarioInvalidoError);
  });

  test('rechaza formatos que no son HH:MM', () => {
    expect(() => new RangoHorario({ horaInicio: '9:00', horaFin: '13:00' })).toThrow(RangoHorarioInvalidoError);
    expect(() => new RangoHorario({ horaInicio: '09:00', horaFin: 'trece' })).toThrow(RangoHorarioInvalidoError);
  });

  test('rechaza horas faltantes', () => {
    expect(() => new RangoHorario({ horaInicio: null, horaFin: '13:00' })).toThrow(RangoHorarioInvalidoError);
    expect(() => new RangoHorario({ horaInicio: '09:00', horaFin: undefined })).toThrow(RangoHorarioInvalidoError);
  });

  test('rechaza duración fuera de [5, 480] minutos', () => {
    expect(() => new RangoHorario({ horaInicio: '09:00', horaFin: '13:00', duracionCitaMin: 4 })).toThrow(RangoHorarioInvalidoError);
    expect(() => new RangoHorario({ horaInicio: '00:00', horaFin: '23:59', duracionCitaMin: 481 })).toThrow(RangoHorarioInvalidoError);
  });

  test('rechaza un rango más corto que una sola cita', () => {
    expect(() => new RangoHorario({ horaInicio: '09:00', horaFin: '09:20', duracionCitaMin: 30 })).toThrow(RangoHorarioInvalidoError);
  });
});
