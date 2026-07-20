// Este archivo SÍ abre/cierra circuitos reales (a diferencia de los tests de
// adaptadores, que nunca llegan al volumeThreshold) — mockeado para no
// arrastrar el setInterval de ping de realtime.routes.js a este test run.
jest.mock('../../../../src/shared/infrastructure/realtime.routes', () => ({
  emitirEventoOperacional: jest.fn(),
}));

const { crearCircuitBreaker } = require('../../../../src/shared/resilience/circuitBreaker');
const { circuitBreakerStateGauge } = require('../../../../src/config/metrics');
const { CB_VOLUME_THRESHOLD, CB_RESET_TIMEOUT_MS } = require('../../../../src/shared/resilience/config');

async function leerGauge(nombreServicio) {
  const snapshot = await circuitBreakerStateGauge.get();
  const serie = snapshot.values.find((v) => v.labels.service === nombreServicio);
  return serie ? serie.value : undefined;
}

describe('shared/resilience/circuitBreaker', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('semilla el gauge en 0 (Cerrado) al construir — sin esperar la primera transición', async () => {
    crearCircuitBreaker({ nombreServicio: 'test-cb-seed', accion: async () => 'ok' });
    expect(await leerGauge('test-cb-seed')).toBe(0);
  });

  test('llamadas exitosas mantienen el circuito cerrado', async () => {
    const { breaker } = crearCircuitBreaker({ nombreServicio: 'test-cb-closed', accion: async () => 'ok' });
    for (let i = 0; i < 10; i++) await breaker.fire();
    expect(breaker.opened).toBe(false);
    expect(await leerGauge('test-cb-closed')).toBe(0);
  });

  test('abre el circuito tras superar volumeThreshold con fallos', async () => {
    const accion = jest.fn().mockRejectedValue(new Error('caído'));
    const { breaker } = crearCircuitBreaker({ nombreServicio: 'test-cb-open', accion });

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await breaker.fire().catch(() => {});
    }

    expect(breaker.opened).toBe(true);
    expect(await leerGauge('test-cb-open')).toBe(1);
  });

  test('rechaza inmediatamente (fail-fast) sin invocar la acción una vez abierto', async () => {
    const accion = jest.fn().mockRejectedValue(new Error('caído'));
    const { breaker } = crearCircuitBreaker({ nombreServicio: 'test-cb-failfast', accion });

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await breaker.fire().catch(() => {});
    }
    expect(breaker.opened).toBe(true);
    const llamadasAntes = accion.mock.calls.length;

    await expect(breaker.fire()).rejects.toThrow();
    expect(accion.mock.calls.length).toBe(llamadasAntes); // no llamó de nuevo a la acción real
  });

  test('errorFilter excluye ciertos errores del conteo de fallas — el circuito NO abre, pero el error se sigue propagando', async () => {
    const errorNegocio = Object.assign(new Error('no encontrado'), { response: { status: 404 } });
    const accion = jest.fn().mockRejectedValue(errorNegocio);
    const { breaker } = crearCircuitBreaker({
      nombreServicio: 'test-cb-filter',
      accion,
      errorFilter: (err) => err.response?.status === 404,
    });

    for (let i = 0; i < CB_VOLUME_THRESHOLD * 2; i++) {
      await expect(breaker.fire()).rejects.toThrow('no encontrado'); // se sigue propagando
    }

    expect(breaker.opened).toBe(false);
    expect(accion).toHaveBeenCalledTimes(CB_VOLUME_THRESHOLD * 2); // nunca hizo fail-fast
  });

  test('medio-abre tras resetTimeout, sonda exitosa cierra el circuito y dispara la recuperación — sin intervención manual', async () => {
    let fallar = true;
    const { breaker, registrarRecuperacion } = crearCircuitBreaker({
      nombreServicio: 'test-cb-heal',
      accion: async () => { if (fallar) throw new Error('caído'); return 'ok'; },
    });

    let recuperacionLlamada = false;
    registrarRecuperacion(() => { recuperacionLlamada = true; });

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await breaker.fire().catch(() => {});
    }
    expect(breaker.opened).toBe(true);

    fallar = false;
    await jest.advanceTimersByTimeAsync(CB_RESET_TIMEOUT_MS + 100);

    const resultado = await breaker.fire(); // sonda de half-open
    expect(resultado).toBe('ok');
    expect(breaker.opened).toBe(false);
    expect(await leerGauge('test-cb-heal')).toBe(0);
    expect(recuperacionLlamada).toBe(true);
  });

  test('sonda de half-open fallida vuelve a abrir el circuito', async () => {
    const accion = jest.fn().mockRejectedValue(new Error('sigue caído'));
    const { breaker } = crearCircuitBreaker({ nombreServicio: 'test-cb-reopen', accion });

    for (let i = 0; i < CB_VOLUME_THRESHOLD; i++) {
      await breaker.fire().catch(() => {});
    }
    expect(breaker.opened).toBe(true);

    await jest.advanceTimersByTimeAsync(CB_RESET_TIMEOUT_MS + 100);
    await breaker.fire().catch(() => {}); // sonda — también falla

    expect(breaker.opened).toBe(true);
    expect(await leerGauge('test-cb-reopen')).toBe(1);
  });

  test('sin registrarRecuperacion() no revienta al cerrar (callback es opcional)', async () => {
    const { breaker } = crearCircuitBreaker({ nombreServicio: 'test-cb-sin-recovery', accion: async () => 'ok' });
    await expect(breaker.fire()).resolves.toBe('ok');
  });
});
