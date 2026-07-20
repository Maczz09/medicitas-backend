const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarSMSPacienteUseCase {
  constructor({ mensajesSMSRepository }) {
    this.smsRepo = mensajesSMSRepository;
  }

  async ejecutar(idPaciente, { pagina, porPagina }) {
    if (!idPaciente) {
      throw new DomainError('PARAMETRO_REQUERIDO', 400, 'El idPaciente es requerido');
    }
    const p = parseInt(pagina || '1', 10);
    const pp = parseInt(porPagina || '20', 10);

    return await this.smsRepo.findByIdPaciente(idPaciente, { pagina: p, porPagina: pp });
  }
}

module.exports = { ConsultarSMSPacienteUseCase };
