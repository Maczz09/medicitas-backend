process.env.ASEGURADORA_API_URL = 'http://localhost:4001/api/v2';
process.env.SEGUROS_FALLBACK_URL = 'http://localhost:4010';
process.env.ASEGURADORA_API_KEY = 'test-key';
process.env.INTERNAL_SERVICE_TOKEN = 'test-token';

// axios.create() se llama DOS veces en este módulo (cliente principal +
// fallbackClient module-level) — el mock devuelve una instancia DISTINTA por
// baseURL para poder controlarlas por separado en los tests.
jest.mock('axios', () => {
  const registro = {};
  const create = jest.fn((config = {}) => {
    const key = config.baseURL || 'sin-baseURL';
    if (!registro[key]) registro[key] = { get: jest.fn(), put: jest.fn(), patch: jest.fn(), post: jest.fn() };
    return registro[key];
  });
  return { create, __registro: registro };
});
const axios = require('axios');
const clienteAseguradora = () => axios.__registro['http://localhost:4001/api/v2'];
const clienteFallback = () => axios.__registro['http://localhost:4010'];

const { AseguradoraAxiosAdapter } = require('../../../src/modules/seguros/adapters/out/gateway/AseguradoraAxiosAdapter');
const { CB_VOLUME_THRESHOLD, CB_RESET_TIMEOUT_MS } = require('../../../src/shared/resilience/config');

describe('seguros/AseguradoraAxiosAdapter', () => {
  let adaptador;

  beforeEach(() => {
    jest.useFakeTimers();
    // Construir PRIMERO: this.client se crea en el constructor (axios.create
    // no se ejecuta hasta entonces), fallbackClient ya existe desde el
    // require() del módulo arriba.
    adaptador = new AseguradoraAxiosAdapter();
    clienteAseguradora().get.mockReset();
    clienteFallback().get.mockReset();
    clienteFallback().put.mockReset().mockResolvedValue({});
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: asegurado:true mapea a APROBADA y cachea best-effort', async () => {
    clienteAseguradora().get.mockResolvedValue({
      data: { asegurado: true, porcentajeCobertura: 80, numeroPoliza: 'POL-1', vigencia: { fechaFin: '2026-12-31' } },
    });

    const resultado = await adaptador.validarPoliza({
      idPaciente: 'p1', idAseguradora: 'ASEG-1', numeroPoliza: '12345678', tipoConsulta: 'CONSULTA_GENERAL',
    });

    expect(resultado.estadoCobertura).toBe('APROBADA');
    expect(resultado.porcentajeCobertura).toBe(80);
    expect(resultado.esFallback).toBe(false); // RespuestaSanitizer siempre lo fija explícito
    expect(clienteFallback().put).toHaveBeenCalledTimes(1); // cache-aside fire-and-forget
  });

  test('asegurado:false mapea a RECHAZADA', async () => {
    clienteAseguradora().get.mockResolvedValue({ data: { asegurado: false } });

    const resultado = await adaptador.validarPoliza({
      idPaciente: 'p1', idAseguradora: 'ASEG-1', numeroPoliza: '12345678', tipoConsulta: 'CONSULTA_GENERAL',
    });

    expect(resultado.estadoCobertura).toBe('RECHAZADA');
  });

  test('agota reintentos y cae al fallback PENDIENTE si el cache tampoco tiene el dato', async () => {
    clienteAseguradora().get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    clienteFallback().get.mockRejectedValue(new Error('fallback también caído'));

    const promesa = adaptador.validarPoliza({
      idPaciente: 'p1', idAseguradora: 'ASEG-1', numeroPoliza: '12345678', tipoConsulta: 'CONSULTA_GENERAL',
    });
    await jest.advanceTimersByTimeAsync(20000);
    const resultado = await promesa;

    expect(resultado.estadoCobertura).toBe('PENDIENTE');
    expect(resultado.esFallback).toBe(true);
    expect(clienteAseguradora().get).toHaveBeenCalledTimes(3);
  });

  test('agota reintentos pero el cache SÍ tiene el dato: responde con datos reales, no PENDIENTE ciego', async () => {
    clienteAseguradora().get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    clienteFallback().get.mockResolvedValue({
      data: { encontrado: true, vigente: true, porcentajeCobertura: 80, fechaFin: '2026-12-31' },
    });

    const promesa = adaptador.validarPoliza({
      idPaciente: 'p1', idAseguradora: 'ASEG-1', numeroPoliza: '12345678', tipoConsulta: 'CONSULTA_GENERAL',
    });
    await jest.advanceTimersByTimeAsync(20000);
    const resultado = await promesa;

    expect(resultado.estadoCobertura).toBe('APROBADA');
    expect(resultado.origenFallback).toBe('CACHE');
  });

  test('el timeout por intento escala (2s → 4s → 8s)', async () => {
    clienteAseguradora().get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    clienteFallback().get.mockRejectedValue(new Error('sin cache'));

    const promesa = adaptador.validarPoliza({
      idPaciente: 'p1', idAseguradora: 'ASEG-1', numeroPoliza: '12345678', tipoConsulta: 'CONSULTA_GENERAL',
    });
    await jest.advanceTimersByTimeAsync(20000);
    await promesa;

    const timeouts = clienteAseguradora().get.mock.calls.map((args) => args[1].timeout);
    expect(timeouts).toEqual([2000, 4000, 8000]);
  });

  test('registrarRecuperacion delega directo a la factory compartida (sin boilerplate propio)', async () => {
    let llamado = false;
    adaptador.registrarRecuperacion(() => { llamado = true; });

    clienteAseguradora().get.mockRejectedValue({ response: { status: 500 } });
    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await adaptador.breaker.fire({ tipoDocumento: 'DNI', numeroDocumento: '12345678' }, 1).catch(() => {});
    }
    expect(adaptador.breaker.opened).toBe(true);

    clienteAseguradora().get.mockResolvedValue({ data: { asegurado: false } });
    await jest.advanceTimersByTimeAsync(CB_RESET_TIMEOUT_MS + 100);
    await adaptador.breaker.fire({ tipoDocumento: 'DNI', numeroDocumento: '12345678' }, 1);

    expect(adaptador.breaker.opened).toBe(false);
    expect(llamado).toBe(true);
  });
});
