const AuthUseCases = require('../../../application/auth.usecases');
const MySQLAuthRepository = require('../../mysql.auth.repository');

const repository = new MySQLAuthRepository();
const authUseCases = new AuthUseCases(repository);

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authUseCases.login(email, password);
    res.status(200).json({ ...result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const result = await authUseCases.refreshToken(refreshToken);
    res.status(200).json({ ...result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.register = async (req, res, next) => {
  try {
    const result = await authUseCases.register(req.body);
    res.status(201).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.listUsuarios = async (req, res, next) => {
  try {
    const { q, page, limit } = req.query;
    const result = await authUseCases.listUsuarios(q, page, limit);
    res.status(200).json({ ...result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.generateOTP = async (req, res, next) => {
  try {
    const { email } = req.body;
    await authUseCases.generateOTP(email);
    res.status(200).json({ mensaje: 'Código OTP enviado al correo', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { email, otpCode, newPassword } = req.body;
    await authUseCases.resetPassword(email, otpCode, newPassword);
    res.status(200).json({ mensaje: 'Contraseña restablecida exitosamente', correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};

exports.assignRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rolNombre } = req.body;
    const result = await authUseCases.assignRole(id, rolNombre);
    res.status(200).json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
};
