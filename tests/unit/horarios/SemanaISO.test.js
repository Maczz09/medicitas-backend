const { SemanaISO } = require('../../../src/modules/horarios/domain/value-objects/SemanaISO');
const { SemanaInvalidaError } = require('../../../src/modules/horarios/domain/horarios.errors');

describe('SemanaISO — normalización al lunes de la semana (local, sin bug UTC)', () => {
  // 2026-07-06 es lunes; 2026-07-08 miércoles; 2026-07-12 domingo
  test('un miércoles se normaliza al lunes de su semana', () => {
    expect(new SemanaISO('2026-07-08').toString()).toBe('2026-07-06');
  });

  test('un lunes se queda en sí mismo', () => {
    expect(new SemanaISO('2026-07-06').toString()).toBe('2026-07-06');
  });

  test('un DOMINGO pertenece a la semana que empezó 6 días antes (no a la siguiente)', () => {
    expect(new SemanaISO('2026-07-12').toString()).toBe('2026-07-06');
  });

  test('cruce de mes: el domingo 2026-08-02 → lunes 2026-07-27', () => {
    expect(new SemanaISO('2026-08-02').toString()).toBe('2026-07-27');
  });

  test('acepta Date y usa componentes LOCALES aunque la hora sea 23:30 (bug UTC-5 Lima)', () => {
    // Con toISOString() un 23:30 local de Lima saltaría al día siguiente en UTC
    const miercolesNoche = new Date(2026, 6, 8, 23, 30); // 2026-07-08 23:30 local
    expect(new SemanaISO(miercolesNoche).toString()).toBe('2026-07-06');
  });

  test('rechaza fechas inválidas', () => {
    expect(() => new SemanaISO('no-es-fecha')).toThrow(SemanaInvalidaError);
  });
});
