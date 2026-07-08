// Composición del módulo horarios — instancia repositorio, adaptadores y
// casos de uso una sola vez, y los expone listos para inyectar en quien los
// necesite. Mismo rol que "routes/*.routes.js" cumple como raíz de
// composición en citas/prescripciones/seguros — pero horarios no expone su
// propio router montado por separado (fase 1 del plan mantiene TODA la
// superficie pública bajo /api/v2/medicos/:id/..., ver medicos.routes.js).
const dbPool = require('../../config/database');
const logger = require('../../shared/logger/logger');

const { HorariosMySQLRepository } = require('./adapters/out/repositories/HorariosMySQLRepository');
const { OutboxMySQLPublisher } = require('./adapters/out/events/OutboxMySQLPublisher');
const { MedicoValidatorAdapter } = require('./adapters/out/medicos/MedicoValidatorAdapter');
const { OcupacionCitasDBAdapter } = require('./adapters/out/citas/OcupacionCitasDBAdapter');

const { ResolverHorarioEfectivoUseCase } = require('./application/use-cases/ResolverHorarioEfectivoUseCase');
const { ConsultarDisponibilidadUseCase } = require('./application/use-cases/ConsultarDisponibilidadUseCase');
const { ConsultarSlotsUseCase } = require('./application/use-cases/ConsultarSlotsUseCase');
const { DefinirPlantillaUseCase } = require('./application/use-cases/DefinirPlantillaUseCase');
const { DefinirHorarioSemanaUseCase } = require('./application/use-cases/DefinirHorarioSemanaUseCase');
const { ConsultarHorarioSemanaUseCase } = require('./application/use-cases/ConsultarHorarioSemanaUseCase');
const { RegistrarBloqueoUseCase } = require('./application/use-cases/RegistrarBloqueoUseCase');

const horariosRepository = new HorariosMySQLRepository();
const eventPublisher = new OutboxMySQLPublisher();
const medicoValidatorPort = new MedicoValidatorAdapter();
const ocupacionCitasPort = new OcupacionCitasDBAdapter();
const getConnection = async () => dbPool.getConnection();

const resolverHorarioEfectivoUseCase = new ResolverHorarioEfectivoUseCase({ horariosRepository });

const consultarDisponibilidadUseCase = new ConsultarDisponibilidadUseCase({ medicoValidatorPort, horariosRepository });

const consultarSlotsUseCase = new ConsultarSlotsUseCase({
  medicoValidatorPort,
  resolverHorarioEfectivoUseCase,
  horariosRepository,
  ocupacionCitasPort,
});

const definirPlantillaUseCase = new DefinirPlantillaUseCase({
  medicoValidatorPort,
  horariosRepository,
  eventPublisher,
  getConnection,
  logger,
});

const definirHorarioSemanaUseCase = new DefinirHorarioSemanaUseCase({
  medicoValidatorPort,
  horariosRepository,
  eventPublisher,
  getConnection,
});

const registrarBloqueoUseCase = new RegistrarBloqueoUseCase({
  medicoValidatorPort,
  horariosRepository,
  eventPublisher,
  getConnection,
});

const consultarHorarioSemanaUseCase = new ConsultarHorarioSemanaUseCase({ medicoValidatorPort, horariosRepository });

module.exports = {
  resolverHorarioEfectivoUseCase,
  consultarDisponibilidadUseCase,
  consultarSlotsUseCase,
  definirPlantillaUseCase,
  definirHorarioSemanaUseCase,
  consultarHorarioSemanaUseCase,
  registrarBloqueoUseCase,
};
