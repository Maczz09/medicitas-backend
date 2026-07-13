// Entrypoint del contenedor. Decide entre:
//
//   • Modo normal (CLUSTER_MODE != 'true'): arranca UN solo proceso ejecutando
//     server.js tal cual — comportamiento histórico de producción, sin cambios.
//
//   • Modo clustering (CLUSTER_MODE == 'true'): el proceso primary hace fork de
//     N workers (uno por core por defecto) para aprovechar todos los cores en
//     las pruebas de carga. Cada worker ejecuta server.js y sirve HTTP; el
//     trabajo de fondo (consumers/WhatsApp/realtime) corre SOLO en el worker #1
//     (ver deboCorrerBackground() en server.js).
//
// El nº de workers se adapta a la máquina: os.cpus().length por defecto (12 en
// el desktop, ~8 en la laptop i5), overrideable con WEB_CONCURRENCY.

const cluster = require('cluster');
const os = require('os');

if (process.env.CLUSTER_MODE !== 'true') {
  // Producción / desarrollo normal: proceso único, idéntico a antes.
  require('./server');
} else if (cluster.isPrimary) {
  const workers = parseInt(process.env.WEB_CONCURRENCY || String(os.cpus().length), 10);
  console.log(`[Cluster] Primary ${process.pid} arrancando ${workers} workers (cores: ${os.cpus().length})`);

  let apagando = false;

  for (let i = 0; i < workers; i++) {
    cluster.fork();
  }

  // Servidor de métricas AGREGADO: el primary combina (vía IPC) las métricas de
  // los N workers para que Prometheus vea la suma real y no un solo worker.
  // Ver src/config/metricsServer.js.
  try {
    require('./config/metricsServer').startAggregated();
  } catch (err) {
    console.error('[Cluster] No se pudo iniciar el servidor de métricas agregado:', err.message);
  }

  // Reiniciar workers que se caigan (para no perder capacidad durante la
  // prueba), salvo que estemos en apagado ordenado — si no, `docker stop`
  // dispararía un bucle de reinicio y el contenedor no pararía.
  cluster.on('exit', (worker, code, signal) => {
    if (apagando) return;
    console.warn(`[Cluster] Worker ${worker.process.pid} (id ${worker.id}) murió (code=${code}, signal=${signal}). Reiniciando...`);
    cluster.fork();
  });

  // Docker envía SIGTERM al primary (PID 1). Se reenvía a los workers y se
  // deja de reiniciarlos para un apagado limpio.
  const apagar = (senal) => {
    apagando = true;
    console.log(`[Cluster] ${senal} recibido — apagando workers...`);
    for (const id in cluster.workers) cluster.workers[id].process.kill(senal);
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
} else {
  // Worker: sirve HTTP; el worker #1 además corre el trabajo de fondo.
  require('./server');
}
