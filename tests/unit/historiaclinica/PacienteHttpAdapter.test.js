jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { PacienteHttpAdapter } = require('../../../src/modules/historiaclinica/adapters/out/http/PacienteHttpAdapter');
const { DomainError } = require('../../../src/shared/domain/errors');

describe('historiaclinica/PacienteHttpAdapter', () => {
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

  test('agota reintentos por timeout: DomainError SERVICIO_PACIENTES_NO_DISPONIBLE / 503', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNABORTED' }));
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.existePaciente('p1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toBeInstanceOf(DomainError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'SERVICIO_PACIENTES_NO_DISPONIBLE', status: 503 });
  });

  test('error inesperado (no 404, no timeout/refused): DomainError ERROR_INTERNO_HCL / 500', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 500 } });
    const adaptador = new PacienteHttpAdapter();

    const promesa = adaptador.existePaciente('p1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toMatchObject({ codigo: 'ERROR_INTERNO_HCL', status: 500 });
  });

  test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO (no ERROR_INTERNO_HCL)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
    const adaptador = new PacienteHttpAdapter();

    await expect(adaptador.existePaciente('p1')).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Pacientes' },
    });
  });
});
