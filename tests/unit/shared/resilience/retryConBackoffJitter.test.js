const {
  conReintentos,
  conRetryYFallback,
  esErrorTransitorio,
  calcularBackoffSchedule,
} = require('../../../../src/shared/resilience/retryConBackoffJitter');
const { RETRY_SCHEDULE_MS, RETRY_JITTER_MS } = require('../../../../src/shared/resilience/config');

describe('calcularBackoffSchedule', () => {
  test('devuelve un valor dentro del horario fijo ± el jitter configurado', () => {
    for (let intento = 1; intento <= RETRY_SCHEDULE_MS.length; intento++) {
      const base = RETRY_SCHEDULE_MS[intento - 1];
      for (let i = 0; i < 30; i++) {
        const delay = calcularBackoffSchedule(intento);
        expect(delay).toBeGreaterThanOrEqual(base - RETRY_JITTER_MS);
        expect(delay).toBeLessThanOrEqual(base + RETRY_JITTER_MS);
      }
    }
  });

  test('clampea al último valor del horario si el intento lo excede', () => {
    const ultimoBase = RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1];
    const delay = calcularBackoffSchedule(RETRY_SCHEDULE_MS.length + 5);
    expect(delay).toBeGreaterThanOrEqual(ultimoBase - RETRY_JITTER_MS);
    expect(delay).toBeLessThanOrEqual(ultimoBase + RETRY_JITTER_MS);
  });

  test('nunca devuelve un valor negativo', () => {
    for (let i = 0; i < 50; i++) {
      expect(calcularBackoffSchedule(1)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('esErrorTransitorio', () => {
  test.each([
    ['ECONNREFUSED'],
    ['ECONNRESET'],
    ['ETIMEDOUT'],
    ['ECONNABORTED'],
    ['ERR_NETWORK'],
  ])('código de red %s es transitorio', (code) => {
    expect(esErrorTransitorio({ code })).toBe(true);
  });

  test('respuesta 5xx es transitoria', () => {
    expect(esErrorTransitorio({ response: { status: 503 } })).toBe(true);
    expect(esErrorTransitorio({ response: { status: 500 } })).toBe(true);
  });

  test('respuesta 4xx NO es transitoria', () => {
    expect(esErrorTransitorio({ response: { status: 404 } })).toBe(false);
    expect(esErrorTransitorio({ response: { status: 400 } })).toBe(false);
  });

  test('mensaje que contiene "timeout" es transitorio', () => {
    expect(esErrorTransitorio({ message: 'timeout of 2000ms exceeded' })).toBe(true);
  });

  test('rechazo de circuito abierto (opossum "Breaker is open") NO es transitorio', () => {
    // Sin .code de red ni .response — así falla rápido sin desperdiciar
    // intentos contra un circuito que ya se sabe abierto.
    expect(esErrorTransitorio({ message: 'Breaker is open' })).toBe(false);
  });

  test('error sin code ni response NO es transitorio', () => {
    expect(esErrorTransitorio({ message: 'algo raro' })).toBe(false);
  });
});

describe('conReintentos', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('éxito en el primer intento: no espera, no reintenta', async () => {
    const fn = jest.fn().mockResolvedValue('OK');
    const resultado = await conReintentos(fn, { nombreServicio: 'test-ok' });
    expect(resultado).toBe('OK');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  test('éxito en el segundo intento tras un fallo transitorio — pasa el número de intento a cada llamada', async () => {
    const err = Object.assign(new Error('caído'), { code: 'ECONNREFUSED' });
    const fn = jest.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('OK');

    const promesa = conReintentos(fn, { nombreServicio: 'test-retry' });
    await jest.advanceTimersByTimeAsync(RETRY_SCHEDULE_MS[0] + RETRY_JITTER_MS + 100);
    const resultado = await promesa;

    expect(resultado).toBe('OK');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  test('agota los intentos del horario y relanza el último error', async () => {
    const err = Object.assign(new Error('caído'), { code: 'ECONNREFUSED' });
    const fn = jest.fn().mockRejectedValue(err);

    const promesa = conReintentos(fn, { nombreServicio: 'test-agotado' });
    promesa.catch(() => {}); // evita unhandled rejection mientras avanzamos timers
    const sumaDelays = RETRY_SCHEDULE_MS.slice(0, -1).reduce((a, b) => a + b, 0);
    await jest.advanceTimersByTimeAsync(sumaDelays + RETRY_JITTER_MS * RETRY_SCHEDULE_MS.length + 500);

    await expect(promesa).rejects.toThrow('caído');
    expect(fn).toHaveBeenCalledTimes(RETRY_SCHEDULE_MS.length);
  });

  test('error NO transitorio (4xx) no reintenta, relanza de inmediato', async () => {
    const err = Object.assign(new Error('bad request'), { response: { status: 404 } });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(conReintentos(fn, { nombreServicio: 'test-4xx' })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('sin nombreServicio no revienta (usa "desconocido" internamente)', async () => {
    const fn = jest.fn().mockResolvedValue('OK');
    await expect(conReintentos(fn)).resolves.toBe('OK');
  });
});

describe('conRetryYFallback', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('circuito abierto: fallback inmediato, NUNCA llama a intentarLlamada', async () => {
    const fn = jest.fn();
    const resultado = await conRetryYFallback(fn, () => true, 'FALLBACK', { nombreServicio: 'test-cb-open' });
    expect(resultado).toBe('FALLBACK');
    expect(fn).not.toHaveBeenCalled();
  });

  test('agota intentos y devuelve el fallback (no relanza)', async () => {
    const err = Object.assign(new Error('caído'), { code: 'ECONNREFUSED' });
    const fn = jest.fn().mockRejectedValue(err);

    const promesa = conRetryYFallback(fn, () => false, 'FALLBACK', { nombreServicio: 'test-cb-fallback' });
    const sumaDelays = RETRY_SCHEDULE_MS.slice(0, -1).reduce((a, b) => a + b, 0);
    await jest.advanceTimersByTimeAsync(sumaDelays + RETRY_JITTER_MS * RETRY_SCHEDULE_MS.length + 500);
    const resultado = await promesa;

    expect(resultado).toBe('FALLBACK');
    expect(fn).toHaveBeenCalledTimes(RETRY_SCHEDULE_MS.length);
  });

  test('éxito directo devuelve el resultado real, no el fallback', async () => {
    const fn = jest.fn().mockResolvedValue('REAL');
    const resultado = await conRetryYFallback(fn, () => false, 'FALLBACK', { nombreServicio: 'test-cb-real' });
    expect(resultado).toBe('REAL');
  });

  test('error NO transitorio (4xx): fallback inmediato sin reintentar', async () => {
    const err = Object.assign(new Error('bad'), { response: { status: 404 } });
    const fn = jest.fn().mockRejectedValue(err);
    const resultado = await conRetryYFallback(fn, () => false, 'FALLBACK', { nombreServicio: 'test-cb-4xx' });
    expect(resultado).toBe('FALLBACK');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
