// Cron de limpieza de medicitas_users.peticiones_idempotentes.
//
// La tabla de idempotencia crece sin límite: cada POST con Idempotency-Key
// inserta una fila con el response_body completo. Sin limpieza, degrada los
// SELECT de idempotencia y ocupa disco (las pruebas de carga dejaron ~15k
// filas de una). Las claves solo son útiles durante la ventana de reintento
// del cliente (minutos), así que se borran las más viejas que IDEMPOTENCIA_TTL_H
// horas (default 24).

const db = require('../src/config/database');

const TTL_HORAS = parseInt(process.env.IDEMPOTENCIA_TTL_H || '24');
const INTERVALO_MS = parseInt(process.env.IDEMPOTENCIA_LIMPIEZA_MS || String(60 * 60 * 1000)); // 1h

async function limpiar() {
  try {
    const [res] = await db.query(
      `DELETE FROM medicitas_users.peticiones_idempotentes
       WHERE created_at < NOW() - INTERVAL ? HOUR`,
      [TTL_HORAS]
    );
    if (res.affectedRows > 0) {
      console.log(`[LimpiezaIdempotencia] Borradas ${res.affectedRows} claves más viejas que ${TTL_HORAS}h.`);
    }
  } catch (err) {
    console.error('[LimpiezaIdempotencia] Error al limpiar:', err.message);
  }
}

// Ejecutar al arrancar (sin bloquear si la BD aún no está lista) y luego cada hora.
setTimeout(limpiar, 30_000); // pequeño delay al inicio para dar tiempo a MySQL
setInterval(limpiar, INTERVALO_MS);

console.log(`[Worker] Limpieza de idempotencia iniciada (cada ${INTERVALO_MS / 60000} min, TTL ${TTL_HORAS}h).`);
