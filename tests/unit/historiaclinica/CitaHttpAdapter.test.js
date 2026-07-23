jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { CitaHttpAdapter } = require('../../../src/modules/historiaclinica/adapters/out/http/CitaHttpAdapter');
const { DomainError } = require('../../../src/shared/domain/errors');
const { CB_VOLUME_THRESHOLD } = require('../../../src/shared/resilience/config');

describe('historiaclinica/CitaHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
    mockCliente.patch.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  describe('completarCita', () => {
    test('camino feliz: devuelve la data de la respuesta', async () => {
      mockCliente.patch.mockResolvedValue({ data: { estado: 'Completada' } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.completarCita('CIT-1')).resolves.toEqual({ estado: 'Completada' });
    });

    test('agota reintentos: DomainError DEPENDENCIA_NO_DISPONIBLE / 503 (reintentos agotados)', async () => {
      mockCliente.patch.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
      const adaptador = new CitaHttpAdapter();

      const promesa = adaptador.completarCita('CIT-1');
      promesa.catch(() => {});
      await jest.advanceTimersByTimeAsync(20000);

      await expect(promesa).rejects.toMatchObject({
        codigo: 'DEPENDENCIA_NO_DISPONIBLE',
        status: 503,
        detalles: { motivo: 'REINTENTOS_AGOTADOS', servicio: 'Citas' },
      });
      expect(mockCliente.patch).toHaveBeenCalledTimes(3);
    });

    test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO', async () => {
      mockCliente.patch.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
      const adaptador = new CitaHttpAdapter();

      await expect(adaptador.completarCita('CIT-1')).rejects.toMatchObject({
        codigo: 'DEPENDENCIA_NO_DISPONIBLE',
        status: 503,
        detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Citas' },
      });
    });
  });

  describe('obtenerEstadoCita', () => {
    test('camino feliz: mapea estado e idMedico', async () => {
      mockCliente.get.mockResolvedValue({ data: { estado: 'Pendiente', idMedico: 'M1' } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.obtenerEstadoCita('CIT-1')).resolves.toEqual({ estado: 'Pendiente', idMedico: 'M1' });
    });

    test('404 preservado: devuelve null (no lanza)', async () => {
      mockCliente.get.mockRejectedValue({ response: { status: 404 } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.obtenerEstadoCita('inexistente')).resolves.toBeNull();
    });

    test('ECONNABORTED/ETIMEDOUT: DomainError SERVICIO_CITAS_NO_DISPONIBLE / 503', async () => {
      mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ETIMEDOUT' }));
      const adaptador = new CitaHttpAdapter();

      const promesa = adaptador.obtenerEstadoCita('CIT-1');
      promesa.catch(() => {});
      await jest.advanceTimersByTimeAsync(20000);

      await expect(promesa).rejects.toMatchObject({ codigo: 'SERVICIO_CITAS_NO_DISPONIBLE', status: 503 });
    });

    test('5xx real de Citas (ya reintentado 3 veces): DomainError DEPENDENCIA_NO_DISPONIBLE / 503, no ERROR_INTERNO_HCL', async () => {
      // Bug corregido: un error.response (cualquier status que no sea 404,
      // incluido un 5xx real o el 503 SERVICIO_NO_DISPONIBLE del kill-switch
      // de demo) no tiene `.code` de red ni es EOPENBREAKER, así que antes
      // caía siempre en el 500 genérico — un "Citas no responde bien" se
      // reportaba como error interno confuso en vez de dependencia no
      // disponible (que es lo que realmente es: esErrorTransitorio ya trata
      // los 5xx como reintentables antes de llegar aquí).
      mockCliente.get.mockRejectedValue({ response: { status: 500 } });
      const adaptador = new CitaHttpAdapter();

      const promesa = adaptador.obtenerEstadoCita('CIT-1');
      promesa.catch(() => {});
      await jest.advanceTimersByTimeAsync(20000);

      await expect(promesa).rejects.toMatchObject({
        codigo: 'DEPENDENCIA_NO_DISPONIBLE',
        status: 503,
        detalles: { motivo: 'REINTENTOS_AGOTADOS', servicio: 'Citas' },
      });
    });

    test('error verdaderamente inesperado (sin response ni código de red): DomainError ERROR_INTERNO_HCL / 500', async () => {
      mockCliente.get.mockRejectedValue(new Error('fallo de programación inesperado'));
      const adaptador = new CitaHttpAdapter();

      const promesa = adaptador.obtenerEstadoCita('CIT-1');
      promesa.catch(() => {});
      await jest.advanceTimersByTimeAsync(20000);

      await expect(promesa).rejects.toMatchObject({ codigo: 'ERROR_INTERNO_HCL', status: 500 });
    });

    test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO (no ERROR_INTERNO_HCL)', async () => {
      mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
      const adaptador = new CitaHttpAdapter();

      await expect(adaptador.obtenerEstadoCita('CIT-1')).rejects.toMatchObject({
        codigo: 'DEPENDENCIA_NO_DISPONIBLE',
        status: 503,
        detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Citas' },
      });
    });
  });

  describe('independencia de los 2 circuit breakers', () => {
    test('abrir el breaker de completarCita NO afecta a obtenerEstadoCita', async () => {
      mockCliente.patch.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
      const adaptador = new CitaHttpAdapter();

      // Satura y abre el breaker de completarCita
      for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
        await adaptador.breakerCompletar.fire('CIT-1', 1).catch(() => {});
      }
      expect(adaptador.breakerCompletar.opened).toBe(true);
      expect(adaptador.breakerConsultar.opened).toBe(false);

      // obtenerEstadoCita sigue funcionando con normalidad
      mockCliente.get.mockResolvedValue({ data: { estado: 'Pendiente' } });
      await expect(adaptador.obtenerEstadoCita('CIT-2')).resolves.toEqual({ estado: 'Pendiente', idMedico: null });
    });
  });
});
