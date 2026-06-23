const logger = require('../../../../shared/logger/logger');

class RegistrarEventoUseCase {
  constructor({ trazasRepository }) {
    this.trazasRepo = trazasRepository;
  }

  /**
   * @param {Traza} traza - ya validada estructuralmente por Traza.desdeMensaje()
   */
  async ejecutar(traza) {
    const resultado = await this.trazasRepo.insertar(traza);

    if (!resultado.insertada) {
      // Idempotencia: el evento ya había sido registrado — no es un error
      logger.info(
        { idEvento: traza.idEvento, tipoEvento: traza.tipoEvento },
        'Evento ya registrado previamente (idempotencia). Omitiendo duplicado.'
      );
      return;
    }

    logger.debug(
      { idEvento: traza.idEvento, servicioOrigen: traza.servicioOrigen, tipoEvento: traza.tipoEvento },
      'Traza registrada'
    );
  }
}

module.exports = { RegistrarEventoUseCase };
