const cron = require('node-cron');
const { CitasMySQLRepository } = require('../adapters/out/repositories/CitasMySQLRepository');
const { OutboxMySQLPublisher } = require('../adapters/out/events/OutboxMySQLPublisher');
const pool = require('../../../../config/database');

const citasRepo = new CitasMySQLRepository();
const eventPublisher = new OutboxMySQLPublisher();

// Tolerance Worker: Se ejecuta cada minuto
cron.schedule('* * * * *', async () => {
  try {
    // 1. Obtener citas pendientes atrasadas (fecha_hora <= NOW)
    const citasAtrasadas = await citasRepo.getPendientesAtrasadas(0);
    
    if (citasAtrasadas.length === 0) return;

    for (const cita of citasAtrasadas) {
      const ahora = new Date();
      const diffMs = ahora - cita.fechaHora;
      const diffMin = Math.floor(diffMs / 60000);

      const conn = await pool.getConnection();
      await conn.beginTransaction();

      try {
        if (diffMin >= 15) {
          cita.expirar(); // Pasa a No_Asistida
          await citasRepo.update(cita, conn);
          await eventPublisher.publish(conn, 'CitaExpirada', {
            idCita: cita.id,
            idPaciente: cita.idPaciente,
            idMedico: cita.idMedico,
            fechaHoraCita: cita.fechaHora.toISOString(),
            minutosEsperados: 15
          }, cita.correlationId);
        } else {
          // Emitir alertas a los 0, 5, 10 minutos
          let minutoAlerta = null;
          let minutosRestantes = null;

          if (diffMin >= 10 && !cita.alertaMin10) {
            minutoAlerta = 10;
            minutosRestantes = 5;
            cita.alertaMin10 = true;
          } else if (diffMin >= 5 && diffMin < 10 && !cita.alertaMin5) {
            minutoAlerta = 5;
            minutosRestantes = 10;
            cita.alertaMin5 = true;
          } else if (diffMin >= 0 && diffMin < 5 && !cita.alertaMin0) {
            minutoAlerta = 0;
            minutosRestantes = 15;
            cita.alertaMin0 = true;
          }

          if (minutoAlerta !== null) {
            await citasRepo.update(cita, conn);
            await eventPublisher.publish(conn, 'AlertaRetraso', {
              idCita: cita.id,
              idPaciente: cita.idPaciente,
              idMedico: cita.idMedico,
              minutoAlerta,
              minutosRestantes,
              fechaHoraCita: cita.fechaHora.toISOString()
            }, cita.correlationId);
          }
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        console.error(`[ToleranceWorker] Error procesando cita ${cita.id}:`, err.message);
      } finally {
        conn.release();
      }
    }
  } catch (error) {
    console.error('[ToleranceWorker] Error general:', error);
  }
});

console.log('[ToleranceWorker] Iniciado (Módulo Citas).');
