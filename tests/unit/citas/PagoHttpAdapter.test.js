jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { PagoHttpAdapter } = require('../../../src/modules/citas/adapters/out/http/PagoHttpAdapter');

describe('citas/PagoHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: devuelve { estado } del pago', async () => {
    mockCliente.get.mockResolvedValue({ data: { data: { estado: 'APROBADO' } } });
    const adaptador = new PagoHttpAdapter();
    await expect(adaptador.obtenerPagoDeCita('CIT-1')).resolves.toEqual({ estado: 'APROBADO' });
  });

  test('sin pago o sin estado: devuelve null', async () => {
    mockCliente.get.mockResolvedValue({ data: { data: {} } });
    const adaptador = new PagoHttpAdapter();
    await expect(adaptador.obtenerPagoDeCita('CIT-1')).resolves.toBeNull();
  });

  test('404 preservado: devuelve null (no lanza)', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new PagoHttpAdapter();
    await expect(adaptador.obtenerPagoDeCita('inexistente')).resolves.toBeNull();
  });

  test('agota reintentos: DomainError DEPENDENCIA_NO_DISPONIBLE / 503 (reintentos agotados)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PagoHttpAdapter();

    const promesa = adaptador.obtenerPagoDeCita('CIT-1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'REINTENTOS_AGOTADOS', servicio: 'Pagos' },
    });
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });

  test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
    const adaptador = new PagoHttpAdapter();

    await expect(adaptador.obtenerPagoDeCita('CIT-1')).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Pagos' },
    });
  });
});
