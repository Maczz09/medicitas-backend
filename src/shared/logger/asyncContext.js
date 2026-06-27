const { AsyncLocalStorage } = require('async_hooks');

const asyncContext = new AsyncLocalStorage();

module.exports = asyncContext;
