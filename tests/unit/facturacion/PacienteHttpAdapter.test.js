jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { PacienteHttpAdapter } = require('../../../src/modules/facturacion/adapters/out/http/PacienteHttpAdapter');

describe('facturacion/PacienteHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: devuelve "nombres apellidos" concatenados', async () => {
    mockCliente.get.mockResolvedValue({ data: { nombres: 'Juan', apellidos: 'Pérez' } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.obtenerNombre('p1')).resolves.toBe('Juan Pérez');
  });

  test('catch-all preservado: cualquier error (incluido 404) devuelve null, no lanza', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.obtenerNombre('inexistente')).resolves.toBeNull();
  });

  test('404 no cuenta como falla del circuito (no reintenta)', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PacienteHttpAdapter();
    await adaptador.obtenerNombre('inexistente');
    expect(mockCliente.get).toHaveBeenCalledTimes(1);
  });

  test('fallo transitorio: reintenta 3 veces y termina devolviendo null (no lanza)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.obtenerNombre('p1');
    await jest.advanceTimersByTimeAsync(20000);
    await expect(promesa).resolves.toBeNull();
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });
});
