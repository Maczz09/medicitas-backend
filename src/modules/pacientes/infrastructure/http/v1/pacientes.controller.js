const PacientesUseCases = require('../../../application/pacientes.usecases');
const MySQLPacientesRepository = require('../../mysql.pacientes.repository');

const repository = new MySQLPacientesRepository();
const useCases = new PacientesUseCases(repository);

exports.getAll = async (req, res, next) => {
  try {
    const { q, page, limit } = req.query;
    const result = await useCases.listPacientes(q, page, limit);
    res.status(200).json({ ...result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const paciente = await useCases.getPaciente(req.params.id);
    res.status(200).json({ data: paciente, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const result = await useCases.createPaciente(req.body, req.correlationId);
    res.status(201).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const result = await useCases.updatePaciente(req.params.id, req.body, req.correlationId);
    res.status(200).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.updateContact = async (req, res, next) => {
  try {
    await useCases.updateContacto(req.params.id, req.body, req.correlationId);
    res.status(200).json({ mensaje: 'Datos de contacto en proceso de actualización', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.toggleStatus = async (req, res, next) => {
  try {
    const { activo } = req.body;
    const result = await useCases.toggleEstado(req.params.id, activo, req.correlationId);
    res.status(200).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
