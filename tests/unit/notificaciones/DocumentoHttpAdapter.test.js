jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { DocumentoHttpAdapter } = require('../../../src/modules/notificaciones/adapters/out/http/DocumentoHttpAdapter');

describe('notificaciones/DocumentoHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  test('camino feliz: descarga y devuelve un Buffer', async () => {
    mockCliente.get.mockResolvedValue({ data: Buffer.from('contenido-pdf') });
    const adaptador = new DocumentoHttpAdapter();
    const resultado = await adaptador.descargarBuffer('http://nginx/api/v2/facturacion/comprobantes/FAC-1/pdf');
    expect(Buffer.isBuffer(resultado)).toBe(true);
    expect(resultado.toString()).toBe('contenido-pdf');
  });

  test('descarta el host público y llama solo con el path relativo (cliente ya tiene baseURL interna)', async () => {
    mockCliente.get.mockResolvedValue({ data: Buffer.from('x') });
    const adaptador = new DocumentoHttpAdapter();
    await adaptador.descargarBuffer('http://nginx/api/v2/facturacion/comprobantes/FAC-1/pdf?token=abc');
    expect(mockCliente.get).toHaveBeenCalledWith(
      '/api/v2/facturacion/comprobantes/FAC-1/pdf?token=abc',
      expect.objectContaining({ responseType: 'arraybuffer' }),
    );
  });

  test('agota reintentos: DomainError DEPENDENCIA_NO_DISPONIBLE / 503 (reintentos agotados)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new DocumentoHttpAdapter();

    const promesa = adaptador.descargarBuffer('http://nginx/api/v2/facturacion/comprobantes/FAC-1/pdf');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);

    await expect(promesa).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'REINTENTOS_AGOTADOS', servicio: 'Documentos' },
    });
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });

  test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
    const adaptador = new DocumentoHttpAdapter();

    await expect(adaptador.descargarBuffer('http://nginx/api/v2/facturacion/comprobantes/FAC-1/pdf')).rejects.toMatchObject({
      codigo: 'DEPENDENCIA_NO_DISPONIBLE',
      status: 503,
      detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Documentos' },
    });
  });

  test('usa su PROPIO horario de timeout, más alto que el genérico (5s → 10s → 15s, no 2s/4s/8s)', async () => {
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new DocumentoHttpAdapter();

    const promesa = adaptador.descargarBuffer('http://nginx/api/v2/facturacion/comprobantes/FAC-1/pdf');
    promesa.catch(() => {});
    await jest.advanceTimersByTimeAsync(20000);
    await promesa.catch(() => {});

    const timeouts = mockCliente.get.mock.calls.map((args) => args[1].timeout);
    expect(timeouts).toEqual([5000, 10000, 15000]);
  });
});
