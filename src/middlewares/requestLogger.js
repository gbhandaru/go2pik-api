const { resolveRequestId } = require('../utils/requestId');

function requestLogger(req, res, next) {
  const requestId = resolveRequestId(req);
  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log('[request]', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
    });
  });
  next();
}

module.exports = requestLogger;
