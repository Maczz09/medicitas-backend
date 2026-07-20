require('dotenv').config();
const mysql = require('mysql2/promise');

async function clearDB() {
  console.log('Conectando a MySQL...');
  const connection = await mysql.createConnection({
    host: 'localhost',
    port: 3310,
    user: 'root', // Usamos root para tener permisos sobre todas las BD
    password: process.env.MYSQL_ROOT_PASSWORD || 'root_secret_medicitas',
  });

  const [dbs] = await connection.query('SHOW DATABASES');
  const targetDBs = dbs
    .map(d => d.Database)
    .filter(d => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(d));

  console.log('Bases de datos a limpiar:', targetDBs);
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');

  let tablesCleared = 0;

  for (const db of targetDBs) {
    await connection.query(`USE \`${db}\``);
    const [tables] = await connection.query('SHOW TABLES');
    
    for (const row of tables) {
      const table = Object.values(row)[0];
      
      // Excluir tabla usuarios (y roles para mantener la integridad relacional de usuarios)
      if (db === 'medicitas_users' && (table === 'usuarios' || table === 'roles')) {
        console.log(`Saltando tabla preservada: ${db}.${table}`);
        continue;
      }
      
      console.log(`Vaciando tabla: ${db}.${table}`);
      try {
        await connection.query(`TRUNCATE TABLE \`${table}\``);
      } catch (err) {
        console.error(`Error con TRUNCATE en ${db}.${table}, usando DELETE FROM:`, err.message);
        await connection.query(`DELETE FROM \`${table}\``);
      }
      tablesCleared++;
    }
  }

  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`¡Limpieza completada! Se limpiaron ${tablesCleared} tablas en ${targetDBs.length} bases de datos.`);
  await connection.end();
}

clearDB().catch(console.error);
