const PagosUseCases = require('../../../application/pagos.usecases');
const MySQLPagosRepository = require('../../mysql.pagos.repository');
const PasarelaPagosSimulada = require('../../pasarela.simulada.service');

const repository = new MySQLPagosRepository();
const pasarela = new PasarelaPagosSimulada();
const pagosUseCases = new PagosUseCases(repository, pasarela);

exports.procesarPago = async (req, res, next) => {
  try {
    const pago = await pagosUseCases.procesarPago(req.body, req.correlationId);
    res.status(201).json({ data: pago, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
