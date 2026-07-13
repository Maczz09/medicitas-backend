const { ResolverHorarioEfectivoUseCase } = require('../../../src/modules/horarios/application/use-cases/ResolverHorarioEfectivoUseCase');

// 2026-07-08 es miércoles (getDay() = 3); su semana ISO empieza el lunes 2026-07-06
const FECHA = '2026-07-08';
const CONFIG_DIA = { diaSemana: 3, horaInicio: '09:00', horaFin: '13:00', duracionCitaMin: 30 };

function repoMock({ semana = null, plantilla = null } = {}) {
  return {
    findSemana: jest.fn().mockResolvedValue(semana),
    findPlantillaDia: jest.fn().mockResolvedValue(plantilla),
  };
}

describe('ResolverHorarioEfectivoUseCase — la única fuente de "qué horario aplica"', () => {
  test('si existe la semana específica, gana sobre la plantilla (origen SEMANA)', async () => {
    const semana = { diaConfig: jest.fn().mockReturnValue(CONFIG_DIA) };
    const repo = repoMock({ semana });
    const useCase = new ResolverHorarioEfectivoUseCase({ horariosRepository: repo });

    const r = await useCase.ejecutar('MED-1', FECHA);

    expect(r).toEqual({ ...CONFIG_DIA, origen: 'SEMANA' });
    expect(repo.findSemana).toHaveBeenCalledWith('MED-1', '2026-07-06'); // lunes de la semana
    expect(repo.findPlantillaDia).not.toHaveBeenCalled(); // la plantilla ni se consulta
  });

  test('REGLA CLAVE: semana existente sin config para ese día = día inactivo (NO cae a plantilla)', async () => {
    const semana = { diaConfig: jest.fn().mockReturnValue(null) };
    const repo = repoMock({ semana, plantilla: { activo: true, ...CONFIG_DIA } });
    const useCase = new ResolverHorarioEfectivoUseCase({ horariosRepository: repo });

    const r = await useCase.ejecutar('MED-1', FECHA);

    expect(r).toBeNull();
    expect(repo.findPlantillaDia).not.toHaveBeenCalled();
  });

  test('sin semana específica, cae a la plantilla recurrente (origen PLANTILLA)', async () => {
    const repo = repoMock({ plantilla: { activo: true, horaInicio: '08:00', horaFin: '12:00', duracionCitaMin: 20 } });
    const useCase = new ResolverHorarioEfectivoUseCase({ horariosRepository: repo });

    const r = await useCase.ejecutar('MED-1', FECHA);

    expect(r).toEqual({
      diaSemana: 3,
      horaInicio: '08:00',
      horaFin: '12:00',
      duracionCitaMin: 20,
      origen: 'PLANTILLA',
    });
    expect(repo.findPlantillaDia).toHaveBeenCalledWith('MED-1', 3);
  });

  test('plantilla inactiva = sin horario', async () => {
    const repo = repoMock({ plantilla: { activo: false, ...CONFIG_DIA } });
    const useCase = new ResolverHorarioEfectivoUseCase({ horariosRepository: repo });
    expect(await useCase.ejecutar('MED-1', FECHA)).toBeNull();
  });

  test('sin semana ni plantilla = sin horario', async () => {
    const useCase = new ResolverHorarioEfectivoUseCase({ horariosRepository: repoMock() });
    expect(await useCase.ejecutar('MED-1', FECHA)).toBeNull();
  });
});
