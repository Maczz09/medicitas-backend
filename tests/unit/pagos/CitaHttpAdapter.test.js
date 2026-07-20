jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
  return { create: jest.fn(() => mockInstance) };
});
const axios = require('axios');
const mockCliente = axios.create();

const { CitaHttpAdapter } = require('../../../src/modules/pagos/adapters/out/http/CitaHttpAdapter');
const { CB_VOLUME_THRESHOLD } = require('../../../src/shared/resilience/config');

describe('pagos/CitaHttpAdapter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCliente.get.mockReset();
    mockCliente.patch.mockReset();
  });
  afterEach(() => { jest.useRealTimers(); });

  describe('obtenerEstadoCita', () => {
    test('camino feliz', async () => {
      mockCliente.get.mockResolvedValue({ data: { estado: 'Pendiente' } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.obtenerEstadoCita('CIT-1')).resolves.toEqual({ estado: 'Pendiente' });
    });

    test('404 preservado: devuelve null', async () => {
      mockCliente.get.mockRejectedValue({ response: { status: 404 } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.obtenerEstadoCita('inexistente')).resolves.toBeNull();
    });

    test('agota reintentos: DomainError DEPENDENCIA_NO_DISPONIBLE / 503 (reintentos agotados)', async () => {
      mockCliente.get.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
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

    test('circuito abierto: DomainError DEPENDENCIA_NO_DISPONIBLE con motivo CIRCUITO_ABIERTO', async () => {
      mockCliente.get.mockRejectedValue(Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }));
      const adaptador = new CitaHttpAdapter();

      await expect(adaptador.obtenerEstadoCita('CIT-1')).rejects.toMatchObject({
        codigo: 'DEPENDENCIA_NO_DISPONIBLE',
        status: 503,
        detalles: { motivo: 'CIRCUITO_ABIERTO', servicio: 'Citas' },
      });
    });
  });

  describe('cancelarCita — compensación idempotente', () => {
    test('camino feliz: devuelve true', async () => {
      mockCliente.patch.mockResolvedValue({ data: {} });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.cancelarCita('CIT-1', 'motivo')).resolves.toBe(true);
    });

    test('404 (cita inexistente): idempotente, devuelve true', async () => {
      mockCliente.patch.mockRejectedValue({ response: { status: 404 } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.cancelarCita('CIT-1', 'motivo')).resolves.toBe(true);
    });

    test('409 (ya cancelada): idempotente, devuelve true', async () => {
      mockCliente.patch.mockRejectedValue({ response: { status: 409 } });
      const adaptador = new CitaHttpAdapter();
      await expect(adaptador.cancelarCita('CIT-1', 'motivo')).resolves.toBe(true);
    });

    test('404 y 409 no cuentan como falla del circuito (idempotencia, no reintenta)', async () => {
      mockCliente.patch.mockRejectedValue({ response: { status: 409 } });
      const adaptador = new CitaHttpAdapter();
      await adaptador.cancelarCita('CIT-1', 'motivo');
      expect(mockCliente.patch).toHaveBeenCalledTimes(1);
    });

    test('fallo transitorio agotado: devuelve false (ya no en silencio — loguea antes)', async () => {
      const logger = require('../../../src/shared/logger/logger');
      const spyWarn = jest.spyOn(logger, 'warn');
      mockCliente.patch.mockRejectedValue(Object.assign(new Error('caído'), { code: 'ECONNREFUSED' }));
      const adaptador = new CitaHttpAdapter();

      const promesa = adaptador.cancelarCita('CIT-1', 'motivo');
      await jest.advanceTimersByTimeAsync(20000);

      await expect(promesa).resolves.toBe(false);
      expect(spyWarn).toHaveBeenCalledWith(
        expect.objectContaining({ idCita: 'CIT-1', code: 'ECONNREFUSED' }),
        expect.any(String),
      );
      spyWarn.mockRestore();
    });
  });

  test('independencia: abrir el breaker de cancelar NO afecta a consultar', async () => {
    mockCliente.patch.mockRejectedValue({ response: { status: 500 } });
    const adaptador = new CitaHttpAdapter();

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await adaptador.breakerCancelar.fire({ idCita: 'CIT-1', motivo: 'x' }, 1).catch(() => {});
    }
    expect(adaptador.breakerCancelar.opened).toBe(true);
    expect(adaptador.breakerConsultar.opened).toBe(false);
  });
});
