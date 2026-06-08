const FacUseCases = require('../../../application/fac.usecases');
const MySQLFacRepository = require('../../mysql.fac.repository');

const repository = new MySQLFacRepository();
const facUseCases = new FacUseCases(repository);

exports.generar = async (req, res, next) => {
  try {
    const comprobante = await facUseCases.generarComprobante(req.body, req.correlationId);
    res.status(201).json({ data: comprobante, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
