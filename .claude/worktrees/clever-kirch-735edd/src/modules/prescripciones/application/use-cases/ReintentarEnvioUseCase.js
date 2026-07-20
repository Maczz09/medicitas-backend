const { DomainError } = require('../../../../shared/domain/errors');

class ReintentarEnvioUseCase {
  constructor({ despachosRepository, iniciarDespachoUseCase, getConnection, logger }) {
    // Reutiliza la lógica de envío de IniciarDespachoUseCase
    this.despachosRepo = despachosRepository;
    this.iniciarDespachoUseCase = iniciarDespachoUseCase;
    this.getConnection = getConnection;
    this.logger = logger;
  }

  async ejecutar(idReceta, correlationId) {
    const connTest = await this.getConnection();
    let despacho;
    try {
        despacho = await this.despachosRepo.findById(idReceta, connTest);
    } finally {
        connTest.release();
    }

    if (!despacho) {
      const err = require('../../domain/prescripciones.errors');
      throw err.RECETA_NO_ENCONTRADA(idReceta);
    }

    despacho.reintentar(); // lanza error si no es RECHAZADA

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.despachosRepo.actualizarEstado(despacho, conn);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // El despacho.contenido debe tener los datos
    await this.iniciarDespachoUseCase._intentarEnvio(despacho, despacho.contenido, correlationId);

    return { idReceta: despacho.id, estado: despacho.estado, mensaje: 'Reintento de envío iniciado.' };
  }
}

module.exports = ReintentarEnvioUseCase;
