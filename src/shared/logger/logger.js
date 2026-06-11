const logger = {
  info: (data, message) => {
    if (typeof data === 'string') console.log(`[INFO] ${data}`);
    else console.log(`[INFO] ${message || ''}`, data);
  },
  warn: (data, message) => {
    if (typeof data === 'string') console.warn(`[WARN] ${data}`);
    else console.warn(`[WARN] ${message || ''}`, data);
  },
  error: (data, message) => {
    if (typeof data === 'string') console.error(`[ERROR] ${data}`);
    else console.error(`[ERROR] ${message || ''}`, data);
  },
  debug: (data, message) => {
    if (typeof data === 'string') console.debug(`[DEBUG] ${data}`);
    else console.debug(`[DEBUG] ${message || ''}`, data);
  }
};

module.exports = logger;
