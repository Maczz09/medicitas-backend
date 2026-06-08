const PreUseCases = require('../../../application/pre.usecases');
const MySQLPreRepository = require('../../mysql.pre.repository');

const repository = new MySQLPreRepository();
const preUseCases = new PreUseCases(repository);

exports.emitirReceta = async (req, res, next) => {
  try {
    const receta = await preUseCases.emitirReceta(req.body, req.correlationId);
    res.status(201).json({ data: receta, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
