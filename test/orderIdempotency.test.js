const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOrderRequestFingerprint,
  createRecentResultCache,
} = require('../src/utils/orderIdempotency');

test('buildOrderRequestFingerprint stays stable for equivalent payloads', () => {
  const left = {
    restaurantId: 12,
    promoCode: 'SAVE10',
    customer: {
      phone: '+15105550123',
      name: 'Guest',
      pickupTime: '2026-05-01T12:00:00.000Z',
    },
    items: [
      { id: 2, name: 'Tea', quantity: 1, price: 3, lineTotal: 3 },
      { id: 1, name: 'Samosa', quantity: 2, price: 4, lineTotal: 8 },
    ],
  };
  const right = {
    promoCode: 'SAVE10',
    customer: {
      pickupTime: '2026-05-01T12:00:00.000Z',
      name: 'Guest',
      phone: '+15105550123',
    },
    restaurantId: 12,
    items: [
      { name: 'Samosa', id: 1, quantity: 2, price: 4, lineTotal: 8 },
      { name: 'Tea', id: 2, quantity: 1, price: 3, lineTotal: 3 },
    ],
  };

  assert.equal(buildOrderRequestFingerprint(left), buildOrderRequestFingerprint(right));
});

test('createRecentResultCache reuses in-flight results only', async () => {
  const cache = createRecentResultCache({ ttlMs: 1_000, maxEntries: 8 });
  let invocations = 0;

  const first = cache.run('same-key', async () => {
    invocations += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { orderId: 123 };
  });
  const second = cache.run('same-key', async () => {
    invocations += 1;
    return { orderId: 999 };
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(invocations, 1);
  assert.strictEqual(firstResult, secondResult);
  assert.deepEqual(firstResult, { orderId: 123 });

  const thirdResult = await cache.run('same-key', async () => {
    invocations += 1;
    return { orderId: 456 };
  });

  assert.equal(invocations, 2);
  assert.notStrictEqual(thirdResult, firstResult);
  assert.deepEqual(thirdResult, { orderId: 456 });
});
