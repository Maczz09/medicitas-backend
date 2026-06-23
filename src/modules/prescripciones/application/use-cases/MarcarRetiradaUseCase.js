const { v4: uuidv4 } = require('uuid');

class MarcarRetiradaUseCase {
  constructor({ despachosRepository, eventPublisher, getConnection, logger }) {
    this.despachosRepo = despachosRepository;
    this.eventPublisher = eventPublisher;
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

    despacho.marcarRetirada(); // Lanza error si no está DESPACHADA

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.despachosRepo.actualizarEstado(despacho, conn);
      
      await this.eventPublisher.publish(conn, 'RecetaRetirada', {
        idReceta: despacho.id,
        idPaciente: despacho.idPaciente,
        fechaRetiro: despacho.fechaRetiro,
      }, correlationId || uuidv4());

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return {
      idReceta: despacho.id,
      estado: despacho.estado,
      fechaRetiro: despacho.fechaRetiro,
      mensaje: 'Retirada registrada con éxito.',
      correlationId: correlationId || null
    };
  }
}

module.exports = MarcarRetiradaUseCase;
