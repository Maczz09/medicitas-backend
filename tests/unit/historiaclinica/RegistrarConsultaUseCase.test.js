// El paquete `uuid` instalado (v14) es ESM-only y Jest no lo transforma por
// defecto (mismo motivo por el que no había tests previos de este use case) —
// se mockea aquí, igual que axios en el resto de la suite.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-0000-0000-000000000000' }));

const { RegistrarConsultaUseCase } = require('../../../src/modules/historiaClinica/application/use-cases/RegistrarConsultaUseCase');
const { DomainError } = require('../../../src/shared/domain/errors');

const DTO_BASE = {
  idPaciente: 'PAC-1',
  idCita: 'CIT-1',
  diagnosticoCie10: 'J10',
  descripcion: null,
  prescripciones: [],
  idMedico: 'MED-1',
  rolUsuario: 'Auditor',
  idUsuario: 'USR-1',
};

// Flush todas las promesas pendientes (el fire-and-forget de completarCita()
// no se await-ea dentro de ejecutar(), así que su .catch() async corre en
// microtasks posteriores al return de ejecutar()).
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function armarUseCase({ completarCita } = {}) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  const expedienteRepository = {
    findByIdPaciente: jest.fn().mockResolvedValue({ id: 'EXP-1' }),
  };
  const encuentroRepository = {
    save: jest.fn().mockResolvedValue(),
    savePrescripcion: jest.fn().mockResolvedValue(),
    marcarCitaPendienteReconciliar: jest.fn().mockResolvedValue(),
  };
  const eventPublisher = { publish: jest.fn().mockResolvedValue() };
  const citaValidator = {
    obtenerEstadoCita: jest.fn().mockResolvedValue({ estado: 'En_Atencion', idMedico: 'MED-1' }),
    completarCita: completarCita || jest.fn().mockResolvedValue({ estado: 'Completada' }),
  };
  const getConnection = jest.fn().mockResolvedValue(conn);

  const useCase = new RegistrarConsultaUseCase({
    expedienteRepository, encuentroRepository, citaValidator, eventPublisher, getConnection,
  });
  return { useCase, encuentroRepository, eventPublisher, citaValidator, conn };
}

describe('RegistrarConsultaUseCase — reconciliación de "completar cita"', () => {
  test('camino feliz: completarCita resuelve, no marca pendiente ni publica inconsistencia', async () => {
    const { useCase, encuentroRepository, eventPublisher } = armarUseCase();

    await useCase.ejecutar(DTO_BASE, 'corr-1');
    await flush();

    expect(encuentroRepository.marcarCitaPendienteReconciliar).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalledWith(
      expect.anything(), 'CitaCompletadaInconsistente', expect.anything(), expect.anything(),
    );
  });

  test('Citas inalcanzable al completar (dependencia caída): el encuentro se guarda igual y queda marcado pendiente de reconciliar', async () => {
    const completarCita = jest.fn().mockRejectedValue(
      Object.assign(new DomainError('DEPENDENCIA_NO_DISPONIBLE', 503, 'caído'), { code: 'EOPENBREAKER' }),
    );
    const { useCase, encuentroRepository, eventPublisher } = armarUseCase({ completarCita });

    const res = await useCase.ejecutar(DTO_BASE, 'corr-2');
    await flush();

    // El encuentro clínico NUNCA se pierde ni se bloquea por esto.
    expect(res.estado).toBe('REGISTRADO');
    expect(encuentroRepository.marcarCitaPendienteReconciliar).toHaveBeenCalledWith(res.idEncuentro);
    // No es una inconsistencia (aún no sabemos si aplica o no) — solo pendiente.
    expect(eventPublisher.publish).not.toHaveBeenCalledWith(
      expect.anything(), 'CitaCompletadaInconsistente', expect.anything(), expect.anything(),
    );
  });

  test('Citas rechaza la transición (409 CITA_TRANSICION_INVALIDA): NO se marca pendiente, se publica inconsistencia para revisión humana', async () => {
    const completarCita = jest.fn().mockRejectedValue(
      new DomainError('CITA_TRANSICION_INVALIDA', 409, 'La cita ya no puede completarse (el estado cambió).'),
    );
    const { useCase, encuentroRepository, eventPublisher } = armarUseCase({ completarCita });

    const res = await useCase.ejecutar(DTO_BASE, 'corr-3');
    await flush();

    // Nunca se reintenta esta transición — Citas ya dijo que no aplica.
    expect(encuentroRepository.marcarCitaPendienteReconciliar).not.toHaveBeenCalled();

    const llamadaInconsistencia = eventPublisher.publish.mock.calls.find(
      ([, evento]) => evento === 'CitaCompletadaInconsistente',
    );
    expect(llamadaInconsistencia).toBeTruthy();
    const [, , payload] = llamadaInconsistencia;
    expect(payload).toMatchObject({ idEncuentro: res.idEncuentro, idCita: 'CIT-1' });
  });
});
