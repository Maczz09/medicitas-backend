const SegurosUseCases = require('../../../application/seguros.usecases');
const MySQLSegurosRepository = require('../../mysql.seguros.repository');
const AseguradoraACLService = require('../../acl.aseguradora.service');

const repository = new MySQLSegurosRepository();
const acl = new AseguradoraACLService();
const segurosUseCases = new SegurosUseCases(repository, acl);

exports.validarCobertura = async (req, res, next) => {
  try {
    const validacion = await segurosUseCases.validarCobertura(req.body, req.correlationId);
    res.status(200).json({ data: validacion, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
