const { v4: uuidv4 } = require('uuid');
const asyncContext = require('../logger/asyncContext');

function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  
  asyncContext.run(new Map([['correlationId', correlationId]]), () => {
    next();
  });
}

module.exports = { correlationMiddleware };
