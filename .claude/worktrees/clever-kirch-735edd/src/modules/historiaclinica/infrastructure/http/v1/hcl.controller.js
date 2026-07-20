const HclUseCases = require('../../../application/hcl.usecases');
const MySQLHclRepository = require('../../mysql.hcl.repository');

const repository = new MySQLHclRepository();
const hclUseCases = new HclUseCases(repository);

exports.crearExpediente = async (req, res, next) => {
  try {
    const expediente = await hclUseCases.crearExpediente(req.body, req.correlationId);
    res.status(201).json({ data: expediente, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.registrarEncuentro = async (req, res, next) => {
  try {
    const encuentro = await hclUseCases.registrarEncuentro(req.params.idPaciente, req.body, req.correlationId);
    res.status(201).json({ data: encuentro, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
