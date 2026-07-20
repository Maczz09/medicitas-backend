jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { CoberturaHttpAdapter } = require('../../../src/modules/pagos/adapters/out/http/CoberturaHttpAdapter');

describe('pagos/CoberturaHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: devuelve estadoCobertura y codigoAutorizacion', async () => {
    mockCliente.get.mockResolvedValue({ data: { estadoCobertura: 'APROBADA', codigoAutorizacion: 'AUT-1' } });
    const adaptador = new CoberturaHttpAdapter();
    await expect(adaptador.obtenerCobertura('COB-1')).resolves.toEqual({
      estadoCobertura: 'APROBADA',
      codigoAutorizacion: 'AUT-1',
    });
  });

  test('404 preservado: devuelve null', async () => {
    mockCliente.get.mockRejectedValue({ response: { status: 404 } });
    const adaptador = new CoberturaHttpAdapter();
    await expect(adaptador.obtenerCobertura('inexistente')).resolves.toBeNull();
  });

  test('agota reintentos: DomainError DEPENDENCIA_NO_DISPONIBLE / 503 (reintentos agotados)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new CoberturaHttpAdapter();

    const promesa = adaptador.obtenerCobertura('COB-1');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'REINTENTOS_AGOTADOS', servicio: 'Seguros' },
    });
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });

  test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
    const adaptador = new CoberturaHttpAdapter();

    await expect(adaptador.obtenerCobertura('COB-1')).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Seguros' },
    });
  });
});
