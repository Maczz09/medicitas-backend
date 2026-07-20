process.env.FARMACIA_API_KEY = 'test-key';
process.env.FARMACIA_API_URL = 'http://farmacia_api:4002/api/v2/farmacia/recepcionar-receta';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const FarmaciaAxiosAdapter = require('../../../src/modules/prescripciones/adapters/out/gateway/FarmaciaAxiosAdapter');
const { CB_VOLUME_THRESHOLD, CB_RESET_TIMEOUT_MS } = require('../../../src/shared/resilience/config');

const DATOS = { idReceta: 'REC-1', farmaciaId: 'FARM-001', idEncuentroClinico: 'ENC-1', medicamento: 'X', dosis: '1', cantidad: 1 };

describe('prescripciones/FarmaciaAxiosAdapter', () => {
  let adaptador;

  beforeEach(() => {
    jest.useFakeTimers();
    adaptador = new FarmaciaAxiosAdapter({ nombreServicio: 'test-farmacia' });
    mockCliente.post.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('200 + aceptada:true → receta aceptada', async () => {
    mockCliente.post.mockResolvedValue({ status: 200, data: { aceptada: true, referencia: 'REF-1' } });
    const resultado = await adaptador.enviarReceta(DATOS);
    expect(resultado).toEqual({ aceptada: true, referenciaFarmacia: 'REF-1', motivoRechazo: null, origenFallo: null });
  });

  test('200 + aceptada:false → rechazo de NEGOCIO, no cuenta como falla del circuito', async () => {
    mockCliente.post.mockResolvedValue({ status: 200, data: { aceptada: false, motivo: 'Sin stock' } });
    const resultado = await adaptador.enviarReceta(DATOS);
    expect(resultado.aceptada).toBe(false);
    expect(resultado.origenFallo).toBe('NEGOCIO');
    expect(resultado.motivoRechazo).toBe('Sin stock');
    expect(adaptador.breaker.opened).toBe(false);
  });

  test('400/401 → error de configuración, se propaga pero NO abre el circuito (errorFilter)', async () => {
    mockCliente.post.mockResolvedValue({ status: 401, data: { mensaje: 'API key inválida' } });

    for (let i = 0; i < CB_VOLUME_THRESHOLD * 2; i++) {
      const resultado = await adaptador.enviarReceta(DATOS);
      // conRetryYFallback atrapa el throw interno y devuelve el fallback de TRANSPORTE
      // (el 400/401 SÍ se retiene como "no reintentable" — ver esErrorTransitorio)
      expect(resultado.origenFallo).toBe('TRANSPORTE');
    }
    expect(adaptador.breaker.opened).toBe(false); // el error de config nunca contó para el CB
  });

  test('5xx → falla de disponibilidad real: agota reintentos y cae al fallback TRANSPORTE', async () => {
    mockCliente.post.mockResolvedValue({ status: 503, data: {} });

    const promesa = adaptador.enviarReceta(DATOS);
    await jest.advanceTimersByTimeAsync(20000);
    const resultado = await promesa;

    expect(resultado.aceptada).toBe(false);
    expect(resultado.origenFallo).toBe('TRANSPORTE');
    expect(mockCliente.post).toHaveBeenCalledTimes(3);
  });

  test('5xx repetido abre el circuito (SÍ cuenta como falla de disponibilidad)', async () => {
    mockCliente.post.mockResolvedValue({ status: 503, data: {} });

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await adaptador.breaker.fire(DATOS, 1).catch(() => {});
    }
    expect(adaptador.breaker.opened).toBe(true);
  });

  test('el timeout por intento escala (2s → 4s → 8s)', async () => {
    mockCliente.post.mockResolvedValue({ status: 503, data: {} });

    const promesa = adaptador.enviarReceta(DATOS);
    await jest.advanceTimersByTimeAsync(20000);
    await promesa;

    const timeouts = mockCliente.post.mock.calls.map((args) => args[2].timeout);
    expect(timeouts).toEqual([2000, 4000, 8000]);
  });

  test('dos instancias con nombreServicio distinto tienen breakers independientes (fix de la colisión de gauge)', async () => {
    mockCliente.post.mockResolvedValue({ status: 503, data: {} });
    const despacho = new FarmaciaAxiosAdapter({ nombreServicio: 'FarmaciaAPI-Despacho-test' });
    const reintento = new FarmaciaAxiosAdapter({ nombreServicio: 'FarmaciaAPI-Reintento-test' });

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await reintento.breaker.fire(DATOS, 1).catch(() => {});
    }
    expect(reintento.breaker.opened).toBe(true);
    expect(despacho.breaker.opened).toBe(false); // instancia distinta, breaker independiente
  });

  test('registrarRecuperacion delega directo a la factory (self-healing sin intervención)', async () => {
    let llamado = false;
    adaptador.registrarRecuperacion(() => { llamado = true; });

    mockCliente.post.mockResolvedValue({ status: 503, data: {} });
    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await adaptador.breaker.fire(DATOS, 1).catch(() => {});
    }
    expect(adaptador.breaker.opened).toBe(true);

    mockCliente.post.mockResolvedValue({ status: 200, data: { aceptada: true, referencia: 'REF-1' } });
    await jest.advanceTimersByTimeAsync(CB_RESET_TIMEOUT_MS + 100);
    await adaptador.breaker.fire(DATOS, 1);

    expect(adaptador.breaker.opened).toBe(false);
    expect(llamado).toBe(true);
  });
});
