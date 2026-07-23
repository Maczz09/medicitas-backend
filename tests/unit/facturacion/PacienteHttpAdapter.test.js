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

  test('camino feliz: devuelve "nombre apellido" concatenados (respuesta real envuelta en data)', async () => {
    // GET /api/v2/pacientes/:id responde { data: { nombre, apellido, ... } }
    // — envuelto y en singular, no { nombres, apellidos } sueltos.
    mockCliente.get.mockResolvedValue({ data: { data: { nombre: 'Juan', apellido: 'Pérez' } } });
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

  test('fallo transitorio: reintenta 3 veces y luego LANZA (no devuelve null) para que el use case marque nombreVerificado=false', async () => {
    // A diferencia del 404 (resultado de negocio válido, sí devuelve null),
    // una dependencia inalcanzable debe propagarse: GenerarComprobanteUseCase
    // la atrapa y persiste nombreVerificado=false para que el recovery-replay
    // la reconcilie cuando Pacientes se recupere — swallow-a-null aquí haría
    // que el comprobante quedara con el nombre en blanco para siempre.
    mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
    const adaptador = new PacienteHttpAdapter();

    // El `.rejects` se adjunta ANTES de avanzar los timers (no después): si
    // la promesa rechaza durante advanceTimersByTimeAsync sin un handler ya
    // enganchado, Node la reporta como unhandled rejection en esa misma
    // vuelta de microtask, antes de que la siguiente línea llegue a atraparla.
    const promesa = adaptador.obtenerNombre('p1');
    const expectativa = expect(promesa).rejects.toThrow('caído');
    await jest.advanceTimersByTimeAsync(20000);
    await expectativa;
    expect(mockCliente.get).toHaveBeenCalledTimes(3);
  });
});
