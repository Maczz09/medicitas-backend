const CitasUseCases = require('../../../application/citas.usecases');
const MySQLCitasRepository = require('../../mysql.citas.repository');

const repository = new MySQLCitasRepository();
const citasUseCases = new CitasUseCases(repository);

exports.reservar = async (req, res, next) => {
  try {
    const cita = await citasUseCases.reservarCita(req.body, req.correlationId);
    res.status(201).json({ data: cita, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.cancelar = async (req, res, next) => {
  try {
    await citasUseCases.cancelarCita(req.params.id, req.body.motivo, req.correlationId);
    res.status(200).json({ mensaje: 'Cita cancelada', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.obtenerPorId = async (req, res, next) => {
  try {
    const cita = await repository.findById(req.params.id);
    if (!cita) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    res.status(200).json({ data: cita, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
