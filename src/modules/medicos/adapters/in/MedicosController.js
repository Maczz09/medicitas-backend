const MedicosUseCases = require('../../application/medicos.usecases');
const MedicosMySQLRepository = require('../out/repositories/MedicosMySQLRepository');
const AuthUseCases = require('../../../auth/application/auth.usecases');
const AuthMySQLRepository = require('../../../auth/adapters/out/repositories/AuthMySQLRepository');
const { DomainError } = require('../../../../shared/domain/errors');

// Disponibilidad/slots/horarios/bloqueos viven ahora en el módulo horarios
// (ver plan de módulo horarios, Fase 1) — medicos.usecases.js conserva esos
// métodos por compatibilidad histórica pero ya no se invocan desde aquí.
// Mismo patrón que ya usa este archivo para auth (requerir y componer un
// módulo hermano directamente), no una ruptura de convención nueva.
const horarios = require('../../../horarios');

const repository = new MedicosMySQLRepository();
const medicosUseCases = new MedicosUseCases(repository);
const authRepository = new AuthMySQLRepository();
const authUseCases = new AuthUseCases(authRepository);

exports.getAll = async (req, res, next) => {
  try {
    const data = await medicosUseCases.listMedicos();
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const data = await medicosUseCases.getMedico(req.params.id);
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.updateMedico = async (req, res, next) => {
  try {
    const data = await medicosUseCases.updateMedico(req.params.id, req.body);
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.createMedico = async (req, res, next) => {
  try {
    const { cmp, nombre, apellido, especialidad, email, password } = req.body;

    // Si se va a crear cuenta de acceso, validar el correo ANTES de crear el médico
    // para no dejar un médico huérfano si el usuario fallara por correo duplicado.
    if (email) {
      const existe = await authRepository.findUserByEmail(email);
      if (existe) {
        throw new DomainError('USER_CONFLICT', 'El correo ya está registrado', 409);
      }
    }

    const medico = await medicosUseCases.createMedico({ cmp, nombre, apellido, especialidad });

    // Creación completa: cuenta de usuario (rol Médico) vinculada al médico por id_medico.
    let usuario = null;
    if (email && password) {
      usuario = await authUseCases.register({
        nombre,
        apellido,
        email,
        password,
        rolNombre: 'Médico',
        idMedico: medico.id_medico,
      });
    }

    res.status(201).json({ data: { ...medico, usuario }, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.getDisponibilidad = async (req, res, next) => {
  try {
    // El médico en sí lo sigue dueño este módulo; horarios/bloqueos ya no.
    const [medico, { horarios: listaHorarios, bloqueos }] = await Promise.all([
      medicosUseCases.getMedico(req.params.id),
      horarios.consultarDisponibilidadUseCase.ejecutar(req.params.id),
    ]);
    res.status(200).json({ data: { medico, horarios: listaHorarios, bloqueos }, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.registrarHorarios = async (req, res, next) => {
  try {
    await horarios.definirPlantillaUseCase.ejecutar(req.params.id, req.body.horarios, req.correlationId);
    res.status(200).json({ mensaje: 'Horarios registrados', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.getSlotsForDate = async (req, res, next) => {
  try {
    const { fecha } = req.query; // YYYY-MM-DD
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ mensaje: 'El parámetro fecha es obligatorio (YYYY-MM-DD)' });
    }
    const data = await horarios.consultarSlotsUseCase.ejecutar(req.params.id, fecha);
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.registrarBloqueo = async (req, res, next) => {
  try {
    const bloqueo = await horarios.registrarBloqueoUseCase.ejecutar(req.params.id, req.body, req.correlationId);
    res.status(201).json({ data: { id_bloqueo: bloqueo.idBloqueo }, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

// ── Fase 2 del módulo horarios: semana específica ─────────────────────────
exports.getHorarioSemana = async (req, res, next) => {
  try {
    const data = await horarios.consultarHorarioSemanaUseCase.ejecutar(req.params.id, req.params.semanaInicio);
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.definirHorarioSemana = async (req, res, next) => {
  try {
    await horarios.definirHorarioSemanaUseCase.ejecutar(
      req.params.id,
      req.params.semanaInicio,
      req.body.dias,
      req.correlationId,
    );
    res.status(200).json({ mensaje: 'Horario de la semana registrado', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
