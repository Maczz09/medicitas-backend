const db = require('../../../config/database');

class MySQLPreRepository {
  async emitirPrescripcion(prescripcion, conn = db) {
    await conn.query(
      `INSERT INTO svc_hcl.prescripciones_clinicas 
       (id_prescripcion, id_encuentro, id_paciente, medicamento, dosis, frecuencia, duracion, indicaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        prescripcion.id_prescripcion, prescripcion.id_encuentro, prescripcion.id_paciente,
        prescripcion.medicamento, prescripcion.dosis, prescripcion.frecuencia,
        prescripcion.duracion, prescripcion.indicaciones
      ]
    );
  }

  async crearDespacho(despacho, conn = db) {
    await conn.query(
      `INSERT INTO svc_pre.despachos_receta
       (id_receta, id_prescripcion, id_encuentro, id_paciente, estado)
       VALUES (?, ?, ?, ?, ?)`,
      [
        despacho.id_receta, despacho.id_prescripcion, despacho.id_encuentro,
        despacho.id_paciente, 'CREADA'
      ]
    );
  }
}

module.exports = MySQLPreRepository;
