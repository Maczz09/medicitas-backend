const { ICitasRepository } = require('../../../ports/out');
const { Cita } = require('../../../domain/entities/Cita');

class CitasMySQLRepository extends ICitasRepository {
  async findById(id) {
    const pool = require('../../../../../config/database');
    const [rows] = await pool.query('SELECT * FROM svc_cit.citas WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return new Cita({
      id: row.id,
      idPaciente: row.id_paciente,
      idMedico: row.id_medico,
      fechaHora: row.fecha_hora,
      especialidad: row.especialidad,
      estado: row.estado,
      correlationId: row.correlation_id,
      recordatorio30m: !!row.recordatorio_30m,
      alertaMin0: !!row.alerta_min0,
      alertaMin5: !!row.alerta_min5,
      alertaMin10: !!row.alerta_min10,
      pagoVerificado: row.pago_verificado === undefined ? true : !!row.pago_verificado,
    });
  }

  async save(cita, connection) {
    const query = `
      INSERT INTO svc_cit.citas 
      (id, id_paciente, id_medico, fecha_hora, especialidad, estado, correlation_id, recordatorio_30m)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await connection.execute(query, [
      cita.id,
      cita.idPaciente,
      cita.idMedico,
      cita.fechaHora,
      cita.especialidad,
      cita.estado,
      cita.correlationId,
      cita.recordatorio30m ? 1 : 0,
    ]);
    return cita;
  }

  async update(cita, connection) {
    const query = `
      UPDATE svc_cit.citas
      SET id_medico = ?, fecha_hora = ?, estado = ?, pago_verificado = ?,
          recordatorio_30m = ?, alerta_min0 = ?, alerta_min5 = ?, alerta_min10 = ?
      WHERE id = ?
    `;
    const params = [
      cita.idMedico,
      cita.fechaHora,
      cita.estado,
      cita.pagoVerificado ? 1 : 0,
      cita.recordatorio30m ? 1 : 0,
      cita.alertaMin0 ? 1 : 0,
      cita.alertaMin5 ? 1 : 0,
      cita.alertaMin10 ? 1 : 0,
      cita.id,
    ];

    if (connection) {
      await connection.execute(query, params);
    } else {
      const pool = require('../../../../../config/database');
      await pool.execute(query, params);
    }
    return cita;
  }

  // Ingresos registrados con Pagos inalcanzable en su momento — candidatos a
  // reconciliar cuando Citas→Pagos se recupera. Newest-first, mismo criterio
  // que Seguros/Pagos: el ingreso reciente, con Auditor mirando la pantalla,
  // se beneficia más de una corrección instantánea que uno viejo.
  async findPendientesVerificacionPago(limit) {
    const pool = require('../../../../../config/database');
    const limiteSeguro = Number.isInteger(Number(limit)) ? Number(limit) : 20;
    const [rows] = await pool.query(
      `SELECT id FROM svc_cit.citas
       WHERE pago_verificado = 0
       ORDER BY created_at DESC
       LIMIT ${limiteSeguro}`
    );
    return rows.map((r) => r.id);
  }

  // Recibe conexión de la TX del caller (mismo criterio que update()).
  // Devuelve affectedRows para que el caller detecte si otro worker del
  // clúster ya reconcilió esta fila antes y evite publicar un evento duplicado.
  async marcarPagoVerificado(idCita, connection) {
    const [result] = await connection.execute(
      `UPDATE svc_cit.citas SET pago_verificado = 1
       WHERE id = ? AND pago_verificado = 0`,
      [idCita]
    );
    return result.affectedRows;
  }

  async getPendientesAtrasadas(minutosAtraso) {
    const pool = require('../../../../../config/database');
    const query = `
      SELECT * FROM svc_cit.citas 
      WHERE estado = 'Pendiente' 
      AND fecha_hora <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
    `;
    const [rows] = await pool.query(query, [minutosAtraso]);
    return rows.map(row => new Cita({
      id: row.id,
      idPaciente: row.id_paciente,
      idMedico: row.id_medico,
      fechaHora: row.fecha_hora,
      especialidad: row.especialidad,
      estado: row.estado,
      correlationId: row.correlation_id,
      recordatorio30m: !!row.recordatorio_30m,
      alertaMin0: !!row.alerta_min0,
      alertaMin5: !!row.alerta_min5,
      alertaMin10: !!row.alerta_min10,
    }));
  }
}

module.exports = { CitasMySQLRepository };
