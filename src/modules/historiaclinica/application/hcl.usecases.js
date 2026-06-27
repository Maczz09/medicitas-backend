const { v4: uuidv4 } = require('uuid');
const { ExpedienteDuplicadoError, ExpedienteNoEncontradoError } = require('../domain/hcl.errors');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');

class HclUseCases {
  constructor(hclRepository) {
    this.hclRepository = hclRepository;
  }

  async crearExpediente(datos, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const existente = await this.hclRepository.buscarExpedientePorPaciente(datos.id_paciente, conn);
      if (existente) throw new ExpedienteDuplicadoError();

      const idExpediente = uuidv4();
      const expediente = { ...datos, id_expediente: idExpediente };

      await this.hclRepository.crearExpediente(expediente, conn);

      await publicarEventoOutbox(conn, 'svc_hcl', {
        idEvento: uuidv4(),
        tipoEvento: 'ExpedienteCreado',
        payload: expediente,
        correlationId
      });

      await conn.commit();
      return expediente;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async registrarEncuentro(idPaciente, datosEncuentro, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const expediente = await this.hclRepository.buscarExpedientePorPaciente(idPaciente, conn);
      if (!expediente) throw new ExpedienteNoEncontradoError();

      const idEncuentro = uuidv4();
      const encuentro = {
        ...datosEncuentro,
        id_encuentro: idEncuentro,
        id_expediente: expediente.id_expediente,
        fecha_hora: new Date()
      };

      await this.hclRepository.registrarEncuentro(encuentro, conn);

      await publicarEventoOutbox(conn, 'svc_hcl', {
        idEvento: uuidv4(),
        tipoEvento: 'EncuentroRegistrado',
        payload: encuentro,
        correlationId
      });
      
      const { encuentrosHclCounter } = require('../../../config/metrics');
      encuentrosHclCounter.inc();

      await conn.commit();
      return encuentro;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = HclUseCases;
