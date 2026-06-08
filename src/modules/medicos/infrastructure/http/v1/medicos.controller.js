const MedicosUseCases = require('../../../application/medicos.usecases');
const MySQLMedicosRepository = require('../../mysql.medicos.repository');

const repository = new MySQLMedicosRepository();
const medicosUseCases = new MedicosUseCases(repository);

exports.createMedico = async (req, res, next) => {
  try {
    const medico = await medicosUseCases.createMedico(req.body);
    res.status(201).json({ data: medico, correlationId: req.correlationId });
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

exports.registrarBloqueo = async (req, res, next) => {
  try {
    const result = await medicosUseCases.registrarBloqueo(req.params.id, req.body);
    res.status(201).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
