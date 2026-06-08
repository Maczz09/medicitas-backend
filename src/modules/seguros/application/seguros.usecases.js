const { v4: uuidv4 } = require('uuid');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');

class SegurosUseCases {
  constructor(segurosRepository, aseguradoraAcl) {
    this.segurosRepository = segurosRepository;
    this.aseguradoraAcl = aseguradoraAcl;
  }

  async validarCobertura(datosValidacion, correlationId) {
    const respuestaExterna = await this.aseguradoraAcl.validarPolizaExterna(
      datosValidacion.id_aseguradora, 
      datosValidacion.numero_poliza
    );

    const estadoCobertura = respuestaExterna.aprobado ? 'APROBADA' : 'RECHAZADA';
    const idValidacion = uuidv4();

    const validacion = {
      id_validacion: idValidacion,
      id_paciente: datosValidacion.id_paciente,
      id_aseguradora: datosValidacion.id_aseguradora,
      numero_poliza: datosValidacion.numero_poliza,
      tipo_consulta: datosValidacion.tipo_consulta,
      estado_cobertura: estadoCobertura,
      porcentaje_cobertura: respuestaExterna.porcentajeCobertura,
      codigo_autorizacion: respuestaExterna.codigoAutorizacion,
      respuesta_raw: respuestaExterna
    };

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await this.segurosRepository.guardarValidacion(validacion, conn);

      await publicarEventoOutbox(conn, 'svc_seg', {
        idEvento: uuidv4(),
        tipoEvento: 'CoberturaValidada',
        payload: validacion,
        correlationId
      });

      await conn.commit();
      return validacion;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = SegurosUseCases;
