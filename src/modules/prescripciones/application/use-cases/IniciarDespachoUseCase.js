const Despacho = require('../../domain/entities/Despacho');
const { FARMACIA_DEFAULT_ID } = require('../../../../shared/config/farmacia.config');

class IniciarDespachoUseCase {
  constructor({ despachosRepository, farmaciaGateway, eventPublisher, getConnection, logger, generarRecetaPDFUseCase }) {
    this.despachosRepo = despachosRepository;
    this.farmaciaGateway = farmaciaGateway;
    this.eventPublisher = eventPublisher;
    this.getConnection = getConnection;
    this.logger = logger;
    this.generarRecetaPDFUseCase = generarRecetaPDFUseCase || null;
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
      if (existente.estado === Despacho.ESTADOS.CREADA) {
        this.logger.info({ idEvento }, 'Despacho CREADO encontrado. Reintentando envío (recovery).');
        await this._intentarEnvio(existente, existente.contenido, correlationId);
      } else {
        this.logger.info({ idEvento, estado: existente.estado }, 'PrescripcionEmitida ya procesado con estado final — ignorado');
      }
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

    // Persistir el contador YA, antes de intentar el envío — independiente de
    // la transacción de más abajo. Esa transacción hace rollback cuando el
    // envío falla (rama TRANSPORTE), así que si el contador solo viviera ahí
    // adentro, se perdería en cada fallo y nunca llegaría a acumular: cada
    // reintento (desde RabbitMQ o desde el replay periódico) volvería a leer
    // 0 desde BD y el umbral de "último intento" de más abajo jamás se
    // cumpliría. Confirmado en vivo: con esto roto, un despacho podía
    // reintentarse indefinidamente sin disparar nunca la contingencia.
    await this._persistirIntento(despacho);

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
        // origenFallo === 'TRANSPORTE': timeout, CB abierto, 5xx, error de config.
        //
        // Dispara la contingencia en dos casos, no solo uno:
        //   (a) el CB ya está ABIERTO — caída sostenida detectada por volumen,
        //       útil cuando hay muchas recetas en vuelo y el circuito abre rápido.
        //   (b) este despacho ya agotó (o está en) su último intento permitido
        //       antes de que prescripciones.consumer.js lo mande a DLQ.
        // (b) es necesario porque el CB necesita `volumeThreshold` llamadas
        // fallidas en su ventana rodante para abrir — con pocas recetas en
        // vuelo (1-2, el caso típico de un solo encuentro médico) el consumer
        // agota sus PRE_MAX_REINTENTOS y manda el mensaje a DLQ ANTES de que
        // se junte ese volumen, así que el circuito nunca llega a abrirse y
        // la contingencia jamás se disparaba — el paciente se quedaba sin
        // receta y sin aviso alguno. Usamos el contador persistido en el
        // propio despacho (intentos_envio en BD), no el header efímero de
        // RabbitMQ, para que el umbral sea el mismo sin importar cuántas
        // veces se haya redespachado el mensaje.
        // Best-effort: un fallo aquí jamás debe impedir el reencolado normal.
        const maxIntentosConsumer = parseInt(process.env.PRE_MAX_REINTENTOS || '3');
        const esUltimoIntento = despacho.intentosEnvio >= maxIntentosConsumer;
        if ((this.farmaciaGateway.breaker?.opened || esUltimoIntento) && this.generarRecetaPDFUseCase) {
          try {
            await this.generarRecetaPDFUseCase.ejecutar(despacho, contenido, correlationId, { esContingencia: true });
          } catch (contErr) {
            this.logger.warn({ err: contErr.message, idDespacho: despacho.id },
              '[Contingencia] Fallo generando PDF/WhatsApp de contingencia — no bloquea el reintento normal del despacho.');
          }
        }
        // Lanzamos error para que la transacción se revierta y RabbitMQ reencole el mensaje.
        throw new Error(`Fallo temporal de transporte hacia farmacia-api: ${resultado.motivoRechazo}`);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Fuera de la transacción del despacho: tras un despacho EXITOSO, también
    // se genera un PDF de cortesía + WhatsApp para el paciente (no solo en
    // contingencia) — best-effort, nunca revierte el estado DESPACHADA ya
    // confirmado ni bloquea el flujo si falla.
    if (resultado.aceptada && this.generarRecetaPDFUseCase) {
      try {
        await this.generarRecetaPDFUseCase.ejecutar(despacho, contenido, correlationId, {
          esContingencia: false,
          referenciaFarmacia: resultado.referenciaFarmacia,
        });
      } catch (err) {
        this.logger.warn({ err: err.message, idDespacho: despacho.id },
          '[RecetaPDF] Fallo generando PDF de cortesía tras despacho exitoso — no afecta el estado DESPACHADA ya confirmado.');
      }
    }
  }

  // Escritura aislada, fuera de cualquier transacción de negocio — a
  // propósito, para que sobreviva sin importar si el intento de envío que
  // sigue termina en éxito, rechazo o rollback por fallo de transporte.
  // Best-effort: si esto falla, el envío igual debe continuar (el contador
  // solo decide CUÁNDO forzar la contingencia, nunca si se puede reintentar).
  async _persistirIntento(despacho) {
    const conn = await this.getConnection();
    try {
      await this.despachosRepo.actualizarIntentos(despacho.id, despacho.intentosEnvio, conn);
    } catch (err) {
      this.logger.warn({ err: err.message, idDespacho: despacho.id },
        '[IniciarDespacho] No se pudo persistir el contador de intentos — no bloquea el envío.');
    } finally {
      conn.release();
    }
  }
}

module.exports = IniciarDespachoUseCase;
