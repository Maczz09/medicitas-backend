const { DomainError } = require('../../../../shared/domain/errors');

class ConsultarRecetasContingenciaUseCase {
  constructor({ recetasContingenciaRepository, db }) {
    this.recetasRepo = recetasContingenciaRepository;
    this.db = db;
  }

  async listar({ page, limit }) {
    return this.recetasRepo.findAll({ page, limit }, this.db);
  }

  async obtenerRutaPdf(id) {
    const receta = await this.recetasRepo.findById(id, this.db);
    if (!receta) {
      throw new DomainError('RECETA_CONTINGENCIA_NO_ENCONTRADA', 404,
        `No existe receta de contingencia con id ${id}.`);
    }
    return receta.rutaPdf;
  }
}

module.exports = ConsultarRecetasContingenciaUseCase;
