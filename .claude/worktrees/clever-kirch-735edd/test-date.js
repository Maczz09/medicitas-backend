const mysql = require('mysql2/promise');
async function test(){
  const db = await mysql.createConnection({
    host: 'mysql',
    user: 'root',
    password: 'root_secret_medicitas',
    database: 'svc_cit'
  });
  const [rows] = await db.query('SELECT fecha_hora, alerta_min10 FROM citas WHERE id="CIT-1782940583083-613"');
  const cita = rows[0];
  const now = Date.now();
  const diffMin = Math.floor((now - new Date(cita.fecha_hora).getTime())/60000);
  console.log('fecha_hora raw:', cita.fecha_hora);
  console.log('parsed Date:', new Date(cita.fecha_hora));
  console.log('Date.now() inside container:', new Date(now));
  console.log('diffMin:', diffMin);
  process.exit(0);
}
test();
