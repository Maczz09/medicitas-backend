const { FechaHoraCita } = require('../../../src/modules/citas/domain/value-objects/FechaHoraCita');
const { FechaHoraInvalidaError } = require('../../../src/modules/citas/domain/cita.errors');
const { ValidationError } = require('../../../src/shared/domain/errors');

describe('FechaHoraCita — value object', () => {
  test('acepta una fecha futura', () => {
    const en2h = new Date(Date.now() + 2 * 3600_000);
    const vo = new FechaHoraCita(en2h.toISOString());
    expect(vo.toDate().getTime()).toBe(en2h.getTime());
  });

  test('acepta hasta 30 min en el pasado (agendar en el slot actual)', () => {
    const hace29min = new Date(Date.now() - 29 * 60_000);
    expect(() => new FechaHoraCita(hace29min.toISOString())).not.toThrow();
  });

  test('rechaza más de 30 min en el pasado', () => {
    const hace31min = new Date(Date.now() - 31 * 60_000);
    expect(() => new FechaHoraCita(hace31min.toISOString())).toThrow(FechaHoraInvalidaError);
  });

  test('rechaza formato inválido', () => {
    expect(() => new FechaHoraCita('no-es-fecha')).toThrow(FechaHoraInvalidaError);
  });

  test('rechaza valor vacío', () => {
    expect(() => new FechaHoraCita(undefined)).toThrow(ValidationError);
    expect(() => new FechaHoraCita('')).toThrow(ValidationError);
  });

  test('toDateString/toTimeString usan componentes LOCALES (bug UTC-5 Lima)', () => {
    // 23:30 local: con toISOString() la fecha saltaría al día siguiente en UTC-5
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 30, 0, 0);
    const vo = new FechaHoraCita(d.toISOString());
    const esperadoFecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(vo.toDateString()).toBe(esperadoFecha);
    expect(vo.toTimeString()).toBe('23:30');
  });
});
