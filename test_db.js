const dbPool = require('./src/config/database');

async function test() {
  let conn;
  try {
    conn = await dbPool.getConnection();
    const [result] = await conn.execute(
      `UPDATE svc_seg.validaciones_cobertura 
       SET estado_cobertura = ?
       WHERE numero_poliza = ? 
         AND estado_cobertura != ?`,
      ['SUSPENDIDA', 'POL-2026-74D39D', 'SUSPENDIDA']
    );
    console.log("Success:", result);
  } catch (err) {
    console.error("SQL Error:", err.message);
  } finally {
    if (conn) conn.release();
    process.exit(0);
  }
}

test();
