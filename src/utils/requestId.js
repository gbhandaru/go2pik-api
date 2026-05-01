const crypto = require('crypto');

function resolveRequestId(req = {}) {
  const headerId =
    req.headers?.['x-request-id'] ||
    req.headers?.['x-correlation-id'];
  if (typeof headerId === 'string' && headerId.trim()) {
    return headerId.trim();
  }
  if (typeof req.id === 'string' && req.id.trim()) {
    return req.id.trim();
  }
  return crypto.randomUUID();
}

module.exports = {
  resolveRequestId,
};
