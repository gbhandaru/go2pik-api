const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/services/orderVerificationService');
const configPath = require.resolve('../src/config/env');
const twilioPath = require.resolve('../src/services/twilioSmsService');
const orderServicePath = require.resolve('../src/services/orderService');
const verificationRepoPath = require.resolve('../src/repositories/orderVerificationRepository');

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
    installStub(twilioPath, stubs.twilioSmsService),
    installStub(orderServicePath, stubs.orderService),
    installStub(verificationRepoPath, stubs.verificationRepository),
  ];
  delete require.cache[servicePath];
  const service = require(servicePath);
  return {
    service,
    restore() {
      delete require.cache[servicePath];
      while (restores.length > 0) {
        const restore = restores.pop();
        restore();
      }
    },
  };
}

function buildConfig() {
  return {
    twilio: {
      accountSid: 'AC123',
      authToken: 'auth-token',
      verifyServiceSid: 'VA123',
      requestTimeoutMs: 50,
    },
    verification: {
      otpExpiryMinutes: 10,
      otpResendCooldownSeconds: 30,
      otpMaxAttempts: 5,
    },
    publicLinks: {
      orderReviewBaseUrl: 'https://go2pik.com/order',
    },
  };
}

test('testOrderVerificationService times out when the Twilio Verify service fetch hangs', async () => {
  const { service, restore } = loadService({
    config: buildConfig(),
    twilioSmsService: {
      getTwilioClient() {
        return {
          verify: {
            v2: {
              services() {
                return {
                  fetch: () => new Promise(() => {}),
                  verifications: {
                    create: async () => ({ sid: 'unused' }),
                  },
                };
              },
            },
          },
        };
      },
    },
    orderService: {
      createOrder: async () => null,
      getOrderById: async () => null,
      getOrderByNumber: async () => null,
      prepareOrderDraft: async () => ({ restaurantId: 12 }),
    },
    verificationRepository: {
      createVerificationSession: async () => null,
      getVerificationSessionById: async () => null,
      claimVerificationSessionForProcessing: async () => null,
      updateVerificationSession: async () => null,
    },
  });

  try {
    await assert.rejects(
      service.testOrderVerificationService({ phone: '+15105550123' }),
      (error) => error.code === 'ETIMEDOUT' && error.status === 504
    );
  } finally {
    restore();
  }
});

test('confirmOrderVerification returns the existing order for consumed sessions', async () => {
  const createOrderCalls = [];
  const claimCalls = [];
  const session = {
    id: 'verification-1',
    status: 'consumed',
    customerName: 'Guest',
    phone: '+15105550123',
    customerPhone: '+15105550123',
    restaurantId: 12,
    pickupType: 'ASAP',
    pickupTime: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
    attemptCount: 0,
    maxAttempts: 5,
    verifiedAt: new Date().toISOString(),
    orderId: 99,
    orderNumber: 'R12-00099',
  };

  const { service, restore } = loadService({
    config: buildConfig(),
    twilioSmsService: {
      getTwilioClient() {
        return {
          verify: {
            v2: {
              services() {
                return {
                  fetch: async () => ({ sid: 'VA123' }),
                  verificationChecks: {
                    create: async () => ({ status: 'approved' }),
                  },
                };
              },
            },
          },
        };
      },
    },
    orderService: {
      createOrder: async (payload) => {
        createOrderCalls.push(payload);
        return {
          order: { id: 99, orderNumber: 'R12-00099', restaurant: { id: 12 } },
          automation: { ran: true },
          notification: { delivered: true },
          smsNotification: { delivered: false },
          notifications: { email: {}, sms: {} },
        };
      },
      getOrderById: async (orderId) => ({ id: orderId, orderNumber: 'R12-00099', restaurant: { id: 12 } }),
      getOrderByNumber: async (orderNumber) => ({ id: 99, orderNumber, restaurant: { id: 12 } }),
      prepareOrderDraft: async () => ({ restaurantId: 12 }),
    },
    verificationRepository: {
      createVerificationSession: async () => null,
      getVerificationSessionById: async () => session,
      claimVerificationSessionForProcessing: async (id) => {
        claimCalls.push(id);
        return null;
      },
      updateVerificationSession: async () => session,
    },
  });

  try {
    const result = await service.confirmOrderVerification('verification-1', '123456');
    assert.equal(result.order.id, 99);
    assert.equal(result.order.orderNumber, 'R12-00099');
    assert.equal(result.verification.status, 'consumed');
    assert.equal(createOrderCalls.length, 0);
    assert.equal(claimCalls.length, 0);
  } finally {
    restore();
  }
});

test('startOrderVerification keeps the session pending when Twilio Verify send times out', async () => {
  const createOrderCalls = [];
  const updateCalls = [];
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    errors.push(args);
  };
  const { service, restore } = loadService({
    config: buildConfig(),
    twilioSmsService: {
      getTwilioClient() {
        return {
          verify: {
            v2: {
              services() {
                return {
                  fetch: async () => ({ sid: 'VA123' }),
                  verifications: {
                    create: () => new Promise(() => {}),
                  },
                };
              },
            },
          },
        };
      },
    },
    orderService: {
      createOrder: async (payload) => {
        createOrderCalls.push(payload);
        return null;
      },
      getOrderById: async () => null,
      getOrderByNumber: async () => null,
      prepareOrderDraft: async () => ({
        restaurantId: 12,
        customer: {
          phone: '+15105550124',
          name: 'Guest',
        },
        items: [{ id: 1, name: 'Samosa', quantity: 1, price: 5, lineTotal: 5 }],
        pickupType: 'ASAP',
      }),
    },
    verificationRepository: {
      createVerificationSession: async (fields) => ({
        id: 'verification-timeout-start',
        status: fields.status,
        maskedPhone: fields.maskedPhone,
        customerPhone: fields.customerPhone,
      }),
      getVerificationSessionById: async () => null,
      claimVerificationSessionForProcessing: async () => null,
      updateVerificationSession: async (id, fields) => {
        updateCalls.push({ id, fields });
        return { id, status: fields.status };
      },
    },
  });

  try {
    await assert.rejects(
      service.startOrderVerification({
        smsConsent: true,
        customer: {
          phone: '+15105550124',
          name: 'Guest',
        },
        restaurantId: 12,
        items: [{ name: 'Samosa', quantity: 1 }],
      }),
      (error) => error.code === 'ETIMEDOUT'
    );
    assert.equal(createOrderCalls.length, 0);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].fields.status, 'pending');
    const failureLog = errors.find((entry) =>
      entry[0] === '[orderVerificationService] failed to send Twilio Verify verification'
    );
    assert.ok(failureLog);
    assert.equal(failureLog[1].failureType, 'timeout');
    assert.equal(failureLog[1].retryable, true);
  } finally {
    console.error = originalError;
    restore();
  }
});

test('confirmOrderVerification stores the created order reference before consuming the session', async () => {
  const createOrderCalls = [];
  const claimCalls = [];
  const updateCalls = [];
  const pendingSession = {
    id: 'verification-2',
    status: 'pending',
    customerName: 'Guest',
    phone: '+15105550124',
    customerPhone: '+15105550124',
    restaurantId: 12,
    pickupType: 'ASAP',
    pickupTime: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
    attemptCount: 0,
    maxAttempts: 5,
    verifiedAt: null,
    orderId: null,
    orderNumber: null,
    pendingOrderPayload: {
      restaurantId: 12,
      customer: { phone: '+15105550124' },
      items: [{ id: 1, name: 'Samosa', quantity: 1, price: 5, lineTotal: 5 }],
    },
  };

  const { service, restore } = loadService({
    config: buildConfig(),
    twilioSmsService: {
      getTwilioClient() {
        return {
          verify: {
            v2: {
              services() {
                return {
                  fetch: async () => ({ sid: 'VA123' }),
                  verificationChecks: {
                    create: async () => ({ status: 'approved' }),
                  },
                };
              },
            },
          },
        };
      },
    },
    orderService: {
      createOrder: async (payload) => {
        createOrderCalls.push(payload);
        return {
          order: {
            id: 77,
            orderNumber: 'R12-00077',
            restaurant: { id: 12 },
            customer: { phone: '+15105550124' },
          },
          automation: { ran: true },
          notification: { delivered: true },
          smsNotification: { delivered: false },
          notifications: { email: {}, sms: {} },
        };
      },
      getOrderById: async (orderId) => ({ id: orderId, orderNumber: 'R12-00077', restaurant: { id: 12 } }),
      getOrderByNumber: async (orderNumber) => ({ id: 77, orderNumber, restaurant: { id: 12 } }),
      prepareOrderDraft: async () => ({ restaurantId: 12 }),
    },
    verificationRepository: {
      createVerificationSession: async () => null,
      getVerificationSessionById: async () => pendingSession,
      claimVerificationSessionForProcessing: async (id) => {
        claimCalls.push(id);
        return { ...pendingSession, status: 'processing' };
      },
      updateVerificationSession: async (id, fields) => {
        updateCalls.push({ id, fields });
        return {
          ...pendingSession,
          status: fields.status || pendingSession.status,
          verifiedAt: fields.verified_at || pendingSession.verifiedAt,
          orderId: fields.order_id ?? pendingSession.orderId,
          orderNumber: fields.order_number ?? pendingSession.orderNumber,
        };
      },
    },
  });

  try {
    const result = await service.confirmOrderVerification('verification-2', '123456');
    assert.equal(result.order.id, 77);
    assert.equal(result.order.orderNumber, 'R12-00077');
    assert.equal(result.verification.status, 'consumed');
    assert.equal(createOrderCalls.length, 1);
    assert.equal(claimCalls.length, 1);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].fields.status, 'consumed');
    assert.equal(updateCalls[0].fields.order_id, 77);
    assert.equal(updateCalls[0].fields.order_number, 'R12-00077');
    assert.ok(updateCalls[0].fields.verified_at instanceof Date);
  } finally {
    restore();
  }
});

test('confirmOrderVerification restores the session to pending when Twilio Verify check times out', async () => {
  const updateCalls = [];
  const pendingSession = {
    id: 'verification-timeout-confirm',
    status: 'pending',
    customerName: 'Guest',
    phone: '+15105550126',
    customerPhone: '+15105550126',
    restaurantId: 12,
    pickupType: 'ASAP',
    pickupTime: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
    attemptCount: 0,
    maxAttempts: 5,
    verifiedAt: null,
    orderId: null,
    orderNumber: null,
    pendingOrderPayload: {
      restaurantId: 12,
      customer: { phone: '+15105550126' },
      items: [{ id: 1, name: 'Samosa', quantity: 1, price: 5, lineTotal: 5 }],
    },
  };

  const { service, restore } = loadService({
    config: buildConfig(),
    twilioSmsService: {
      getTwilioClient() {
        return {
          verify: {
            v2: {
              services() {
                return {
                  fetch: async () => ({ sid: 'VA123' }),
                  verificationChecks: {
                    create: () => new Promise(() => {}),
                  },
                };
              },
            },
          },
        };
      },
    },
    orderService: {
      createOrder: async () => ({
        order: {
          id: 88,
          orderNumber: 'R12-00088',
          restaurant: { id: 12 },
          customer: { phone: '+15105550126' },
        },
        automation: { ran: true },
        notification: { delivered: true },
        smsNotification: { delivered: false },
        notifications: { email: {}, sms: {} },
      }),
      getOrderById: async (orderId) => ({ id: orderId, orderNumber: 'R12-00088', restaurant: { id: 12 } }),
      getOrderByNumber: async (orderNumber) => ({ id: 88, orderNumber, restaurant: { id: 12 } }),
      prepareOrderDraft: async () => ({ restaurantId: 12 }),
    },
    verificationRepository: {
      createVerificationSession: async () => null,
      getVerificationSessionById: async () => pendingSession,
      claimVerificationSessionForProcessing: async () => ({ ...pendingSession, status: 'processing' }),
      updateVerificationSession: async (id, fields) => {
        updateCalls.push({ id, fields });
        return {
          ...pendingSession,
          status: fields.status || pendingSession.status,
          verifiedAt: fields.verified_at || pendingSession.verifiedAt,
          orderId: fields.order_id ?? pendingSession.orderId,
          orderNumber: fields.order_number ?? pendingSession.orderNumber,
        };
      },
    },
  });

  try {
    await assert.rejects(
      service.confirmOrderVerification('verification-timeout-confirm', '123456'),
      (error) => error.code === 'ETIMEDOUT'
    );
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].fields.status, 'pending');
  } finally {
    restore();
  }
});

test('confirmOrderVerification marks the session failed if the final consume update fails after order creation', async () => {
  const updateCalls = [];
  const pendingSession = {
    id: 'verification-3',
    status: 'pending',
    customerName: 'Guest',
    phone: '+15105550125',
    customerPhone: '+15105550125',
    restaurantId: 12,
    pickupType: 'ASAP',
    pickupTime: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 30_000).toISOString(),
    attemptCount: 0,
    maxAttempts: 5,
    verifiedAt: null,
    orderId: null,
    orderNumber: null,
    pendingOrderPayload: {
      restaurantId: 12,
      customer: { phone: '+15105550125' },
      items: [{ id: 1, name: 'Samosa', quantity: 1, price: 5, lineTotal: 5 }],
    },
  };

  const { service, restore } = loadService({
    config: buildConfig(),
    twilioSmsService: {
      getTwilioClient() {
        return {
          verify: {
            v2: {
              services() {
                return {
                  fetch: async () => ({ sid: 'VA123' }),
                  verificationChecks: {
                    create: async () => ({ status: 'approved' }),
                  },
                };
              },
            },
          },
        };
      },
    },
    orderService: {
      createOrder: async () => ({
        order: {
          id: 88,
          orderNumber: 'R12-00088',
          restaurant: { id: 12 },
          customer: { phone: '+15105550125' },
        },
        automation: { ran: true },
        notification: { delivered: true },
        smsNotification: { delivered: false },
        notifications: { email: {}, sms: {} },
      }),
      getOrderById: async (orderId) => ({ id: orderId, orderNumber: 'R12-00088', restaurant: { id: 12 } }),
      getOrderByNumber: async (orderNumber) => ({ id: 88, orderNumber, restaurant: { id: 12 } }),
      prepareOrderDraft: async () => ({ restaurantId: 12 }),
    },
    verificationRepository: {
      createVerificationSession: async () => null,
      getVerificationSessionById: async () => pendingSession,
      claimVerificationSessionForProcessing: async () => ({ ...pendingSession, status: 'processing' }),
      updateVerificationSession: async (id, fields) => {
        updateCalls.push({ id, fields });
        if (fields.status === 'consumed') {
          throw new Error('db write failed');
        }
        return {
          ...pendingSession,
          status: fields.status || pendingSession.status,
          verifiedAt: fields.verified_at || pendingSession.verifiedAt,
          orderId: fields.order_id ?? pendingSession.orderId,
          orderNumber: fields.order_number ?? pendingSession.orderNumber,
        };
      },
    },
  });

  try {
    await assert.rejects(
      service.confirmOrderVerification('verification-3', '123456'),
      /db write failed/
    );
    assert.equal(updateCalls.length, 2);
    assert.equal(updateCalls[0].fields.status, 'consumed');
    assert.equal(updateCalls[1].fields.status, 'failed');
    assert.equal(updateCalls[1].fields.order_id, 88);
    assert.equal(updateCalls[1].fields.order_number, 'R12-00088');
  } finally {
    restore();
  }
});
