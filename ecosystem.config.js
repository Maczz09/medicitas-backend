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
      script: './workers/tolerancia.worker.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' }
    }
  ]
};
