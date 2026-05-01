const test = require('node:test');
const assert = require('node:assert/strict');

const requestLogger = require('../src/middlewares/requestLogger');

test('requestLogger propagates request ids and emits structured completion logs', () => {
  const headers = {};
  const finishHandlers = [];
  const logs = [];
  const originalLog = console.log;

  console.log = (...args) => {
    logs.push(args);
  };

  try {
    const req = {
      method: 'POST',
      originalUrl: '/api/orders',
      headers: {
        'x-request-id': 'req-123',
      },
    };
    const res = {
      statusCode: 201,
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = value;
      },
      on(event, handler) {
        if (event === 'finish') {
          finishHandlers.push(handler);
        }
      },
    };

    requestLogger(req, res, () => {});
    assert.equal(req.id, 'req-123');
    assert.equal(headers['x-request-id'], 'req-123');
    assert.equal(finishHandlers.length, 1);

    finishHandlers[0]();

    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[request]');
    assert.equal(logs[0][1].requestId, 'req-123');
    assert.equal(logs[0][1].method, 'POST');
    assert.equal(logs[0][1].path, '/api/orders');
    assert.equal(logs[0][1].statusCode, 201);
    assert.equal(typeof logs[0][1].durationMs, 'number');
  } finally {
    console.log = originalLog;
  }
});
