jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { PacienteHttpAdapter } = require('../../../src/modules/seguros/adapters/out/http/PacienteHttpAdapter');

describe('seguros/PacienteHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: existePaciente devuelve true', async () => {
    mockCliente.get.mockResolvedValue({ data: { id: 'p1' } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.existePaciente('p1')).resolves.toBe(true);
  });

  test('404 preservado: devuelve false (no lanza)', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PacienteHttpAdapter();
    await expect(adaptador.existePaciente('inexistente')).resolves.toBe(false);
  });

  test('agota reintentos: DomainError DEPENDENCIA_NO_DISPONIBLE / 503 (reintentos agotados)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.existePaciente('p1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'REINTENTOS_AGOTADOS', servicio: 'Pacientes' },
    });
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });

  test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
    const adaptador = new PacienteHttpAdapter();

    await expect(adaptador.existePaciente('p1')).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Pacientes' },
    });
  });

  test('usa APP_INTERNAL_BASE_URL para armar el path (unificado, ya no PACIENTES_API_URL)', async () => {
    mockCliente.get.mockResolvedValue({ data: {} });
    const adaptador = new PacienteHttpAdapter();
    await adaptador.existePaciente('p1');
    expect(mockCliente.get).toHaveBeenCalledWith('/api/v2/pacientes/p1', expect.any(Object));
  });
});
