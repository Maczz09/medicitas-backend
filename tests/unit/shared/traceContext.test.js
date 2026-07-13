const { capturarTraceMeta, ejecutarConContexto } = require('../../../src/shared/infrastructure/traceContext');

// Estos tests corren SIN el SDK de OTel registrado (igual que el worker de
// outbox y el modo carga con OTEL_SDK_DISABLED): todo debe degradar limpio.
describe('traceContext — degradación sin SDK de OpenTelemetry', () => {
  test('capturarTraceMeta devuelve {} cuando no hay traza activa', () => {
    expect(capturarTraceMeta()).toEqual({});
  });

  test('ejecutarConContexto ejecuta fn y propaga su retorno (con headers)', async () => {
    const r = await ejecutarConContexto(
      { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      async () => 42,
    );
    expect(r).toBe(42);
  });

  test('ejecutarConContexto ejecuta fn sin headers, con headers vacíos y con basura', () => {
    expect(ejecutarConContexto(undefined, () => 'a')).toBe('a');
    expect(ejecutarConContexto({}, () => 'b')).toBe('b');
    expect(ejecutarConContexto({ traceparent: 12345 }, () => 'c')).toBe('c');
  });

  test('ejecutarConContexto propaga los errores de fn (no los traga)', async () => {
    await expect(
      ejecutarConContexto({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
        async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
  });
});
