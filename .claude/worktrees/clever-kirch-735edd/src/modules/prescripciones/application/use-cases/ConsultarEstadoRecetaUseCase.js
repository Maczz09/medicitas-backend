class ConsultarEstadoRecetaUseCase {
  constructor({ despachosRepository, getConnection }) {
    this.despachosRepo = despachosRepository;
    this.getConnection = getConnection;
  }

  async ejecutar(idReceta) {
    const conn = await this.getConnection();
    try {
      const despacho = await this.despachosRepo.findById(idReceta, conn);
      if (!despacho) {
        const err = require('../../domain/prescripciones.errors');
        throw err.RECETA_NO_ENCONTRADA(idReceta);
      }
      return despacho.toDTO();
    } finally {
      conn.release();
    }
  }
}

module.exports = ConsultarEstadoRecetaUseCase;
