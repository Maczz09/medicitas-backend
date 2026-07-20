const { ConfirmarPagoUseCase } = require('../../../src/modules/pagos/application/use-cases/ConfirmarPagoUseCase');
const { DomainError } = require('../../../src/shared/domain/errors');

const DTO_BASE = {
  idCita: 'CIT-1',
  idPaciente: 'PAC-1',
  metodoPago: 'EFECTIVO',
  montoTotal: 100,
  montoCubiertoSeguro: 80,
  montoCopago: 20,
  tipoComprobante: 'BOLETA',
};

function armarUseCase({
  obtenerCobertura = jest.fn().mockResolvedValue(null),
} = {}) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(),
    // SELECT de duplicado dentro de la TX — sin filas = no hay duplicado.
    execute: jest.fn().mockResolvedValue([[]]),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  const pagosRepository = { save: jest.fn().mockResolvedValue() };
  const eventPublisher = { publish: jest.fn().mockResolvedValue() };
  const citaValidator = {
    obtenerEstadoCita: jest.fn().mockResolvedValue({ estado: 'Completada' }),
  };
  const coberturaValidator = { obtenerCobertura };
  const getConnection = jest.fn().mockResolvedValue(conn);

  const useCase = new ConfirmarPagoUseCase({
    pagosRepository, citaValidator, coberturaValidator, eventPublisher, getConnection,
  });
  return { useCase, pagosRepository, eventPublisher, conn };
}

describe('ConfirmarPagoUseCase — verificación de cobertura', () => {
  test('sin idValidacionCobertura: no llama a Coberturas, coberturaVerificada=true', async () => {
    const obtenerCobertura = jest.fn();
    const { useCase, pagosRepository } = armarUseCase({ obtenerCobertura });

    const res = await useCase.ejecutar(DTO_BASE, 'corr-1');

    expect(obtenerCobertura).not.toHaveBeenCalled();
    expect(res.coberturaVerificada).toBe(true);
    const pagoGuardado = pagosRepository.save.mock.calls[0][0];
    expect(pagoGuardado.coberturaVerificada).toBe(true);
  });

  test('cobertura declarada y verificada con éxito: coberturaVerificada=true', async () => {
    const obtenerCobertura = jest.fn().mockResolvedValue({
      estadoCobertura: 'APROBADA', codigoAutorizacion: 'AUT-1',
    });
    const { useCase } = armarUseCase({ obtenerCobertura });

    const res = await useCase.ejecutar(
      { ...DTO_BASE, idValidacionCobertura: 'COB-1', codigoAutorizacionSeguro: 'AUT-1' },
      'corr-2',
    );

    expect(res.coberturaVerificada).toBe(true);
  });

  test('cobertura rechazada: sigue lanzando COBERTURA_NO_VALIDADA (comportamiento preexistente intacto)', async () => {
    const obtenerCobertura = jest.fn().mockResolvedValue({
      estadoCobertura: 'RECHAZADA', codigoAutorizacion: null,
    });
    const { useCase } = armarUseCase({ obtenerCobertura });

    await expect(
      useCase.ejecutar({ ...DTO_BASE, idValidacionCobertura: 'COB-1' }, 'corr-3'),
    ).rejects.toThrow(DomainError);
  });

  test('Coberturas inalcanzable (dependencia caída): NO bloquea el pago, coberturaVerificada=false y queda persistido', async () => {
    const obtenerCobertura = jest.fn().mockRejectedValue(
      Object.assign(new DomainError('DEPENDENCIA_NO_DISPONIBLE', 503, 'caído'), { code: 'EOPENBREAKER' }),
    );
    const { useCase, pagosRepository, eventPublisher } = armarUseCase({ obtenerCobertura });

    const res = await useCase.ejecutar(
      { ...DTO_BASE, idValidacionCobertura: 'COB-1', codigoAutorizacionSeguro: 'AUT-1' },
      'corr-4',
    );

    // El pago se confirma igual — "no bloquear el cobro" se mantiene.
    expect(res.coberturaVerificada).toBe(false);
    expect(res.mensaje).toMatch(/no se pudo verificar/i);

    const pagoGuardado = pagosRepository.save.mock.calls[0][0];
    expect(pagoGuardado.coberturaVerificada).toBe(false);
    expect(pagoGuardado.idValidacionCobertura).toBe('COB-1');

    const [, evento, payload] = eventPublisher.publish.mock.calls[0];
    expect(evento).toBe('PagoAprobado');
    expect(payload.coberturaVerificada).toBe(false);
  });

  test('404 limpio (cobertura no existe): NO se marca como pendiente — es distinto de dependencia caída', async () => {
    // obtenerCobertura ya modela el 404 devolviendo null (ver CoberturaHttpAdapter.js) — no lanza.
    const obtenerCobertura = jest.fn().mockResolvedValue(null);
    const { useCase, pagosRepository } = armarUseCase({ obtenerCobertura });

    const res = await useCase.ejecutar(
      { ...DTO_BASE, idValidacionCobertura: 'COB-INEXISTENTE' },
      'corr-5',
    );

    expect(res.coberturaVerificada).toBe(true);
    const pagoGuardado = pagosRepository.save.mock.calls[0][0];
    expect(pagoGuardado.coberturaVerificada).toBe(true);
  });
});
