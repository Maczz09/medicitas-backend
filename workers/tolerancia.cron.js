// Lógica de tolerancia migrada a alertas_llegada.cron.js
// Este worker se mantiene como stub para no romper el ecosistema PM2 (el
// nombre de app "worker-tolerancia" sigue reservado en ecosystem.config.js).
// Sin nada que mantenga vivo el event loop, el script terminaba solo al
// llegar al final — PM2 lo reiniciaba en loop infinito (autorestart) cada
// pocos segundos. El intervalo de abajo no hace nada; solo evita ese loop.
const logger = require('../src/shared/logger/logger');

logger.info('[Worker] Tolerancia cron iniciado (cada minuto).');
setInterval(() => {}, 3600_000);
