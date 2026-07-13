const { Bloqueo } = require('../../../src/modules/horarios/domain/entities/Bloqueo');
const { RangoBloqueoInvalidoError } = require('../../../src/modules/horarios/domain/horarios.errors');

describe('Bloqueo — solapamiento con slots', () => {
  const bloqueo = new Bloqueo({
    idBloqueo: 'BLQ-1',
    idMedico: 'MED-1',
    fechaInicio: '2026-07-08T09:30:00',
    fechaFin: '2026-07-08T10:00:00',
    motivo: 'Reunión',
  });

  test('crear() valida y genera id con prefijo', () => {
    const b = Bloqueo.crear({ idMedico: 'MED-1', fechaInicio: '2026-07-08T09:00:00', fechaFin: '2026-07-08T10:00:00' });
    expect(b.idBloqueo).toMatch(/^BLQ-/);
    expect(b.motivo).toBeNull();
  });

  test('rechaza fin <= inicio y fechas inválidas', () => {
    expect(() => new Bloqueo({ fechaInicio: '2026-07-08T10:00:00', fechaFin: '2026-07-08T09:00:00' }))
      .toThrow(RangoBloqueoInvalidoError);
    expect(() => new Bloqueo({ fechaInicio: 'x', fechaFin: '2026-07-08T09:00:00' }))
      .toThrow(RangoBloqueoInvalidoError);
  });

  test('solapa con un slot que cae dentro', () => {
    expect(bloqueo.seSolapaCon(new Date('2026-07-08T09:30:00'), new Date('2026-07-08T10:00:00'))).toBe(true);
    expect(bloqueo.seSolapaCon(new Date('2026-07-08T09:00:00'), new Date('2026-07-08T09:31:00'))).toBe(true);
  });

  test('NO solapa con slots adyacentes (bordes exactos)', () => {
    // Slot que TERMINA exactamente cuando empieza el bloqueo
    expect(bloqueo.seSolapaCon(new Date('2026-07-08T09:00:00'), new Date('2026-07-08T09:30:00'))).toBe(false);
    // Slot que EMPIEZA exactamente cuando termina el bloqueo
    expect(bloqueo.seSolapaCon(new Date('2026-07-08T10:00:00'), new Date('2026-07-08T10:30:00'))).toBe(false);
  });
});
