module.exports = {
  apps: [
    {
      name: 'worker-outbox',
      script: './workers/outbox.worker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'worker-tolerancia',
      script: './workers/tolerancia.cron.js',
      exec_mode: 'fork',
      autorestart: true,
      watch: false
    },
    {
      name: 'worker-alertas-llegada',
      script: './workers/alertas_llegada.cron.js',
      exec_mode: 'fork',
      autorestart: true,
      watch: false
    }
  ]
};
