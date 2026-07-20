const MedicosUseCases = require('../../../application/medicos.usecases');
const MySQLMedicosRepository = require('../../mysql.medicos.repository');
const AuthUseCases = require('../../../../auth/application/auth.usecases');
const MySQLAuthRepository = require('../../../../auth/infrastructure/mysql.auth.repository');
const { DomainError } = require('../../../../../shared/domain/errors');

const repository = new MySQLMedicosRepository();
const medicosUseCases = new MedicosUseCases(repository);
const authRepository = new MySQLAuthRepository();
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
    const data = await medicosUseCases.getDisponibilidadBase(req.params.id);
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.registrarHorarios = async (req, res, next) => {
  try {
    await medicosUseCases.registrarHorarios(req.params.id, req.body.horarios);
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
    const data = await medicosUseCases.getSlotsForDate(req.params.id, fecha);
    res.status(200).json({ data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.registrarBloqueo = async (req, res, next) => {
  try {
    const result = await medicosUseCases.registrarBloqueo(req.params.id, req.body);
    res.status(201).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
