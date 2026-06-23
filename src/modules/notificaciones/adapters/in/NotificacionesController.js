const { DomainError } = require('../../../../shared/domain/errors');

class NotificacionesController {
  constructor({ consultarSMSUseCase }) {
    this.consultarSMSUseCase = consultarSMSUseCase;
    this.consultarPorPaciente = this.consultarPorPaciente.bind(this);
  }

  async consultarPorPaciente(req, res, next) {
    try {
      const { idPaciente } = req.params;
      const pagina    = parseInt(req.query.pagina    || '1', 10);
      const porPagina = parseInt(req.query.porPagina || '20', 10);

      if (isNaN(pagina) || pagina < 1 || isNaN(porPagina) || porPagina < 1 || porPagina > 50) {
        throw new DomainError('DATOS_INVALIDOS', 400, 'Paginación inválida');
      }

      const mensajes = await this.consultarSMSUseCase.ejecutar(idPaciente, { pagina, porPagina });

      return res.status(200).json({
        idPaciente,
        pagina,
        porPagina,
        total: mensajes.length,
        mensajes: mensajes.map(m => ({
          id:               m.id,
          tipoEvento:       m.tipoEvento,
          estado:           m.estado,
          telefono:         m.telefono.slice(0, 3) + '****' + m.telefono.slice(-2), // Enmascarar
          enviado_en:       m.sentAt,
          registrado_en:    m.createdAt,
        })),
        correlationId: req.correlationId,
      });
    } catch (err) { next(err); }
  }
}

module.exports = { NotificacionesController };
