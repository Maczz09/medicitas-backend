jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { PacienteHttpAdapter } = require('../../../src/modules/notificaciones/adapters/out/http/PacienteHttpAdapter');

describe('notificaciones/PacienteHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: devuelve el teléfono recortado', async () => {
    mockCliente.get.mockResolvedValue({ data: { data: { telefono: '  999888777  ' } } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.obtenerTelefono('p1')).resolves.toBe('999888777');
  });

  test('sin teléfono: devuelve null', async () => {
    mockCliente.get.mockResolvedValue({ data: { data: {} } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.obtenerTelefono('p1')).resolves.toBeNull();
  });

  test('404 preservado: devuelve null (no lanza)', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.obtenerTelefono('inexistente')).resolves.toBeNull();
  });

  test('fallo transitorio agotado: relanza crudo (para que el consumer haga NACK)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.obtenerTelefono('p1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toThrow('caído');
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });
});
