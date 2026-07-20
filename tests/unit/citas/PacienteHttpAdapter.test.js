process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { PacienteHttpAdapter } = require('../../../src/modules/citas/adapters/out/http/PacienteHttpAdapter');
const { PacienteNoDisponibleError } = require('../../../src/modules/citas/domain/cita.errors');

describe('citas/PacienteHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: existePaciente devuelve true', async () => {
    mockCliente.get.mockResolvedValue({ data: { id: 'p1' } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.existePaciente('p1')).resolves.toBe(true);
    expect(mockCliente.get).toHaveBeenCalledTimes(1);
  });

  test('404 preservado: existePaciente devuelve false (no lanza)', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.existePaciente('inexistente')).resolves.toBe(false);
  });

  test('404 no cuenta como falla del circuito (no reintenta)', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PacienteHttpAdapter();
    await adaptador.existePaciente('inexistente');
    expect(mockCliente.get).toHaveBeenCalledTimes(1); // sin reintentos
  });

  test('fallo transitorio: reintenta y termina lanzando PacienteNoDisponibleError tras agotar', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.existePaciente('p1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toBeInstanceOf(PacienteNoDisponibleError);
    expect(mockCliente.get).toHaveBeenCalledTimes(3); // agotó el horario de 3 intentos
  });

  test('el timeout por intento escala (2s → 4s → 8s)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.existePaciente('p1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);
    await promesa.catch(() => {});

    const timeouts = mockCliente.get.mock.calls.map((args) => args[1].timeout);
    expect(timeouts).toEqual([2000, 4000, 8000]);
  });
});
