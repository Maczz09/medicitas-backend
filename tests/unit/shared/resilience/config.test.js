const RUTA = '../../../../src/shared/resilience/config';

describe('shared/resilience/config', () => {
  const ENV_VARS = ['RETRY_SCHEDULE_MS', 'RETRY_JITTER_MS', 'TIMEOUT_SCHEDULE_MS', 'CB_TIMEOUT_MS'];
  const originales = {};

  beforeAll(() => {
    ENV_VARS.forEach((v) => { originales[v] = process.env[v]; });
  });

  afterEach(() => {
    jest.resetModules();
    ENV_VARS.forEach((v) => { delete process.env[v]; });
  });

  afterAll(() => {
    ENV_VARS.forEach((v) => {
      if (originales[v] === undefined) delete process.env[v];
      else process.env[v] = originales[v];
    });
  });

  test('valores por defecto: horario de reintentos 3s/5s/8s', () => {
    const config = require(RUTA);
    expect(config.RETRY_SCHEDULE_MS).toEqual([3000, 5000, 8000]);
    expect(config.RETRY_JITTER_MS).toBe(200);
  });

  test('valores por defecto: timeout exponencial 2s/4s/8s', () => {
    const config = require(RUTA);
    expect(config.TIMEOUT_SCHEDULE_MS).toEqual([2000, 4000, 8000]);
  });

  test('obtenerTimeoutParaIntento devuelve el valor correcto por intento (1-based)', () => {
    const { obtenerTimeoutParaIntento } = require(RUTA);
    expect(obtenerTimeoutParaIntento(1)).toBe(2000);
    expect(obtenerTimeoutParaIntento(2)).toBe(4000);
    expect(obtenerTimeoutParaIntento(3)).toBe(8000);
  });

  test('obtenerTimeoutParaIntento clampea al último valor si el intento excede el horario', () => {
    const { obtenerTimeoutParaIntento } = require(RUTA);
    expect(obtenerTimeoutParaIntento(4)).toBe(8000);
    expect(obtenerTimeoutParaIntento(99)).toBe(8000);
  });

  test('CB_TIMEOUT_MS por defecto supera el último timeout del horario (margen de seguridad)', () => {
    const config = require(RUTA);
    const ultimoTimeout = config.TIMEOUT_SCHEDULE_MS[config.TIMEOUT_SCHEDULE_MS.length - 1];
    expect(config.CB_TIMEOUT_MS).toBeGreaterThan(ultimoTimeout);
  });

  test('respeta override de horarios vía env var (CSV)', () => {
    process.env.RETRY_SCHEDULE_MS = '100,200,300';
    process.env.TIMEOUT_SCHEDULE_MS = '10,20,30';
    jest.resetModules();
    const config = require(RUTA);
    expect(config.RETRY_SCHEDULE_MS).toEqual([100, 200, 300]);
    expect(config.TIMEOUT_SCHEDULE_MS).toEqual([10, 20, 30]);
  });

  test('ignora un CSV inválido en el env var y usa el default', () => {
    process.env.RETRY_SCHEDULE_MS = 'no,es,numero';
    jest.resetModules();
    const config = require(RUTA);
    expect(config.RETRY_SCHEDULE_MS).toEqual([3000, 5000, 8000]);
  });

  test('horario propio de PDF: 5s/10s/15s, más alto que el genérico', () => {
    const config = require(RUTA);
    expect(config.PDF_TIMEOUT_SCHEDULE_MS).toEqual([5000, 10000, 15000]);
    expect(config.obtenerTimeoutPdfParaIntento(1)).toBe(5000);
    expect(config.obtenerTimeoutPdfParaIntento(2)).toBe(10000);
    expect(config.obtenerTimeoutPdfParaIntento(3)).toBe(15000);
  });

  test('CB_TIMEOUT_MS_PDF supera el último valor del horario de PDF (margen de seguridad)', () => {
    const config = require(RUTA);
    expect(config.CB_TIMEOUT_MS_PDF).toBeGreaterThan(config.PDF_TIMEOUT_SCHEDULE_MS[2]);
  });

  test('respeta override de RETRY_JITTER_MS y CB_TIMEOUT_MS vía env var', () => {
    process.env.RETRY_JITTER_MS = '50';
    process.env.CB_TIMEOUT_MS = '9999';
    jest.resetModules();
    const config = require(RUTA);
    expect(config.RETRY_JITTER_MS).toBe(50);
    expect(config.CB_TIMEOUT_MS).toBe(9999);
  });
});
