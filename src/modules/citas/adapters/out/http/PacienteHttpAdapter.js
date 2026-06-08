const axios = require('axios');
const jwt = require('jsonwebtoken');
const { IPacienteValidatorPort } = require('../../../ports/out');
const { PacienteNoDisponibleError } = require('../../../domain/cita.errors');

class PacienteHttpAdapter extends IPacienteValidatorPort {
  constructor() {
    super();
    this.baseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
  }

  _generarInternalToken() {
    return jwt.sign(
      { id_usuario: 'svc-cit', rol: 'INTERNAL' },
      process.env.JWT_SECRET,
      { expiresIn: '1m' }
    );
  }

  async existePaciente(idPaciente) {
    try {
      const token = this._generarInternalToken();
      await axios.get(`${this.baseUrl}/pacientes/${idPaciente}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 3000
      });
      return true;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return false;
      }
      throw new PacienteNoDisponibleError();
    }
  }
}

module.exports = { PacienteHttpAdapter };
