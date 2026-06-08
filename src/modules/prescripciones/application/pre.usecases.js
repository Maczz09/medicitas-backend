const { v4: uuidv4 } = require('uuid');
const { publicarEventoOutbox } = require('../../../shared/infrastructure/outbox');
const db = require('../../../config/database');

class PreUseCases {
  constructor(preRepository) {
    this.preRepository = preRepository;
  }

  async emitirReceta(datosReceta, correlationId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const idPrescripcion = uuidv4();
      const idReceta = uuidv4();

      const prescripcion = {
        id_prescripcion: idPrescripcion,
        id_encuentro: datosReceta.id_encuentro,
        id_paciente: datosReceta.id_paciente,
        medicamento: datosReceta.medicamento,
        dosis: datosReceta.dosis,
        frecuencia: datosReceta.frecuencia,
        duracion: datosReceta.duracion,
        indicaciones: datosReceta.indicaciones
      };

      await this.preRepository.emitirPrescripcion(prescripcion, conn);

      const despacho = {
        id_receta: idReceta,
        id_prescripcion: idPrescripcion,
        id_encuentro: datosReceta.id_encuentro,
        id_paciente: datosReceta.id_paciente
      };

      await this.preRepository.crearDespacho(despacho, conn);

      await publicarEventoOutbox(conn, 'svc_pre', {
        idEvento: uuidv4(),
        tipoEvento: 'RecetaEmitida',
        payload: {
          id_receta: idReceta,
          id_prescripcion: idPrescripcion,
          id_paciente: datosReceta.id_paciente,
          medicamento: datosReceta.medicamento
        },
        correlationId
      });

      await conn.commit();
      return { prescripcion, id_receta: idReceta };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = PreUseCases;
