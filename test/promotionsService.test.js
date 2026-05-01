const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/services/promotions.service');
const configPath = require.resolve('../src/config/env');
const repositoryPath = require.resolve('../src/repositories/promotions.repository');

function installStub(modulePath, exports) {
  const original = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
  return () => {
    if (original) {
      require.cache[modulePath] = original;
    } else {
      delete require.cache[modulePath];
    }
  };
}

function loadService(stubs) {
  const restores = [
    installStub(configPath, stubs.config),
    installStub(repositoryPath, stubs.repository),
  ];
  delete require.cache[servicePath];
  const service = require(servicePath);
  return {
    service,
    restore() {
      delete require.cache[servicePath];
      while (restores.length > 0) {
        restores.pop()();
      }
    },
  };
}

function buildPromotion() {
  return {
    id: 7,
    promoCode: 'SAVE10',
    isActive: true,
    restaurantId: 12,
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-12-31T23:59:59.000Z',
    minOrderAmount: 0,
    usageLimitTotal: 10,
    discountType: 'PERCENT',
    discountValue: 10,
  };
}

test('validatePromotion logs sanitized success context', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args);
  };

  const { service, restore } = loadService({
    config: {
      orders: { defaultTaxRate: 0.08 },
    },
    repository: {
      findPromotionByCode: async () => buildPromotion(),
      findPromotionById: async () => buildPromotion(),
      getPromotionUsageCounts: async () => ({ phoneUsage: 0, totalUsage: 0 }),
    },
  });

  try {
    await service.validatePromotion({
      promoCode: 'save10',
      customerPhone: '+15105550123',
      orderAmount: 40,
      restaurantId: 12,
      now: new Date('2025-06-01T00:00:00.000Z'),
    });

    const successLog = logs.find((entry) => entry[0] === '[promotions.service] validation success');
    assert.ok(successLog);
    assert.equal(successLog[1].customerPhonePresent, true);
    assert.equal(Object.prototype.hasOwnProperty.call(successLog[1], 'customerPhone'), false);
    assert.equal(JSON.stringify(successLog[1]).includes('+15105550123'), false);
  } finally {
    restore();
    console.log = originalLog;
  }
});

test('validatePromotion logs sanitized phone-usage rejection context', async () => {
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    logs.push(args);
  };

  const { service, restore } = loadService({
    config: {
      orders: { defaultTaxRate: 0.08 },
    },
    repository: {
      findPromotionByCode: async () => buildPromotion(),
      findPromotionById: async () => buildPromotion(),
      getPromotionUsageCounts: async () => ({ phoneUsage: 1, totalUsage: 1 }),
    },
  });

  try {
    const result = await service.validatePromotion({
      promoCode: 'save10',
      customerPhone: '+15105550123',
      orderAmount: 40,
      restaurantId: 12,
      now: new Date('2025-06-01T00:00:00.000Z'),
    });

    assert.equal(result.valid, false);
    const rejectionLog = logs.find((entry) =>
      entry[0] === '[promotions.service] validation failed: promotion already used by phone'
    );
    assert.ok(rejectionLog);
    assert.equal(rejectionLog[1].customerPhonePresent, true);
    assert.equal(Object.prototype.hasOwnProperty.call(rejectionLog[1], 'customerPhone'), false);
    assert.equal(JSON.stringify(rejectionLog[1]).includes('+15105550123'), false);
  } finally {
    restore();
    console.warn = originalWarn;
  }
});
