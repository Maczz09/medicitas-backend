const Despacho = require('../../domain/entities/Despacho');
const { FARMACIA_DEFAULT_ID } = require('../../../../shared/config/farmacia.config');

class IniciarDespachoUseCase {
  constructor({ despachosRepository, farmaciaGateway, eventPublisher, getConnection, logger }) {
    this.despachosRepo = despachosRepository;
    this.farmaciaGateway = farmaciaGateway;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
    this.logger = logger;
  }

  async ejecutar(payloadPrescripcionEmitida, correlationId, idEvento) {
    // Idempotencia: si este idEvento ya generó un despacho, no se duplica
    const connTest = await this.getConnection();
    let existente;
    try {
        existente = await this.despachosRepo.findByIdEventoOrigen(idEvento, connTest);
    } finally {
        connTest.release();
    }

    if (existente) {
      this.logger.info({ idEvento }, 'PrescripcionEmitida ya procesado anteriormente — ignorado');
      return;
    }

    const despacho = new Despacho({
      id: `REC-${Date.now().toString(36).toUpperCase()}`,
      idEventoOrigen: idEvento,
      idPrescripcionClinica: payloadPrescripcionEmitida.idPrescripcionClinica,
      idEncuentroClinico: payloadPrescripcionEmitida.idEncuentro,
      idPaciente: payloadPrescripcionEmitida.idPaciente,
      idFarmacia: FARMACIA_DEFAULT_ID,
      contenido: payloadPrescripcionEmitida.contenido, // Persistido para reintentos
      correlationId,
    });

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      await this.despachosRepo.save(despacho, conn);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // El intento de envío ocurre DESPUÉS del commit del registro inicial
    await this._intentarEnvio(despacho, payloadPrescripcionEmitida.contenido, correlationId);
  }

  async _intentarEnvio(despacho, contenido, correlationId) {
    despacho.registrarIntentoEnvio();

    // El adaptador NUNCA lanza — siempre resuelve con { aceptada, referenciaFarmacia, motivoRechazo, origenFallo }
    const resultado = await this.farmaciaGateway.enviarReceta({
      idReceta:             despacho.id,
      farmaciaId:           despacho.idFarmacia,
      idEncuentroClinico:   despacho.idEncuentroClinico,
      medicamento:          contenido.medicamento,
      dosis:                contenido.dosis,
      cantidad:             contenido.cantidad,
    });

    const conn = await this.getConnection();
    await conn.beginTransaction();
    try {
      if (resultado.aceptada) {
        // Farmacia aceptó la receta → DESPACHADA
        despacho.marcarDespachada({ referenciaFarmacia: resultado.referenciaFarmacia });
        await this.despachosRepo.actualizarEstado(despacho, conn);
        await this.eventPublisher.publish(conn, 'RecetaDespachada', {
          idReceta:           despacho.id,
          idPaciente:         despacho.idPaciente,
          idEncuentroClinico: despacho.idEncuentroClinico,
          farmacia:           despacho.idFarmacia,
          numero:             despacho.id,
        }, correlationId);

      } else if (resultado.origenFallo === 'NEGOCIO') {
        // Farmacia rechazó por lógica de negocio (sin stock, medicamento no disponible)
        despacho.marcarRechazadaPorStock(resultado.motivoRechazo);
        await this.despachosRepo.actualizarEstado(despacho, conn);
        await this.eventPublisher.publish(conn, 'RecetaRechazada', {
          idReceta:     despacho.id,
          idPaciente:   despacho.idPaciente,
          motivoRechazo: despacho.motivoRechazo,
          tipo:         'STOCK',
        }, correlationId);

      } else {
        // origenFallo === 'TRANSPORTE': timeout, CB abierto, 5xx, error de config
        despacho.marcarRechazadaPorValidacion(resultado.motivoRechazo);
        await this.despachosRepo.actualizarEstado(despacho, conn);
        await this.eventPublisher.publish(conn, 'RecetaRechazada', {
          idReceta:     despacho.id,
          idPaciente:   despacho.idPaciente,
          motivoRechazo: despacho.motivoRechazo,
          tipo:         'VALIDACION',
        }, correlationId);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = IniciarDespachoUseCase;
