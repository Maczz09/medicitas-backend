const { v4: uuidv4 } = require('uuid');

class Expediente {
  constructor({ id, idPaciente, grupoSanguineo = null, alergias = [] }) {
    if (!idPaciente) throw new Error('idPaciente es obligatorio para crear un Expediente');
    this.id = id;
    this.idPaciente = idPaciente;
    this.grupoSanguineo = grupoSanguineo;
    this.alergias = alergias;
  }

  static crear(idPaciente) {
    return new Expediente({
      id: `HCL-${Date.now()}`,
      idPaciente,
    });
  }
}

module.exports = { Expediente };
