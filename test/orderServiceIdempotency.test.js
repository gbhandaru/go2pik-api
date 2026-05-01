const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../src/services/orderService');
const configPath = require.resolve('../src/config/env');
const restaurantServicePath = require.resolve('../src/services/restaurantService');
const customerServicePath = require.resolve('../src/services/customerService');
const notificationServicePath = require.resolve('../src/services/notificationService');
const automationPath = require.resolve('../src/utils/automation');
const orderRepoPath = require.resolve('../src/repositories/orderRepository');
const pickupHoursPath = require.resolve('../src/utils/pickupHours');
const promotionsPath = require.resolve('../src/services/promotions.service');

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
    installStub(restaurantServicePath, stubs.restaurantService),
    installStub(customerServicePath, stubs.customerService),
    installStub(notificationServicePath, stubs.notificationService),
    installStub(automationPath, stubs.automation),
    installStub(orderRepoPath, stubs.orderRepository),
    installStub(pickupHoursPath, stubs.pickupHours),
    installStub(promotionsPath, stubs.promotions),
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
    orders: { defaultTaxRate: 0.08 },
    notifications: { provider: 'custom' },
  };
}

function buildRestaurant() {
  return {
    id: 12,
    name: 'Pik Thai',
    menu: [
      {
        id: 1,
        sku: 'samosa',
        name: 'Samosa',
        price: 5,
        is_available: true,
      },
    ],
    pickupHours: {},
  };
}

test('createOrder only dedupes in-flight duplicate submits and not completed ones', async () => {
  let createOrderRecordCalls = 0;
  let orderId = 100;

  const { service, restore } = loadService({
    config: buildConfig(),
    restaurantService: {
      getRestaurantById: async () => buildRestaurant(),
    },
    customerService: {
      findCustomerById: async () => null,
    },
    notificationService: {
      sendOrderConfirmationEmail: async () => ({ delivered: false }),
      sendOrderConfirmationSms: async () => ({ delivered: false }),
    },
    automation: {
      runOrderAutomation: async () => ({ ran: true }),
    },
    orderRepository: {
      createOrder: async () => {
        createOrderRecordCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        orderId += 1;
        return orderId;
      },
      getOrderById: async (id) => ({
        id,
        orderNumber: `R12-${String(id).padStart(5, '0')}`,
        customer_name: 'Guest',
        customer_phone: '+15105550123',
        customer_email: 'guest@example.com',
        restaurant_id: 12,
        restaurant_name: 'Pik Thai',
        cuisine_type: 'Thai',
        city: 'Fremont',
        state: 'CA',
        subtotal: 5,
        tax_amount: 0.4,
        total_amount: 5,
        payment_mode: 'pay_at_restaurant',
        payment_status: 'unpaid',
        status: 'new',
        acceptance_mode: 'full',
        customer_action: 'none',
        items: JSON.stringify([
          {
            id: 1,
            menuItemId: 1,
            name: 'Samosa',
            quantity: 1,
            price: 5,
            lineTotal: 5,
            specialInstructions: null,
            isAvailable: true,
          },
        ]),
      }),
      getOrderByOrderNumber: async () => null,
      listOrders: async () => [],
      listOrdersForCustomer: async () => [],
      updateCustomerOrderAction: async () => null,
    },
    pickupHours: {
      validateScheduledPickupTime: () => {},
    },
    promotions: {
      normalizePromoCode: (value) => String(value || '').trim().toUpperCase(),
      validatePromotion: async () => ({ valid: false, message: 'no promo' }),
    },
  });

  try {
    const payload = {
      restaurantId: 12,
      customer: {
        phone: '+15105550123',
        name: 'Guest',
      },
      items: [{ name: 'Samosa', quantity: 1 }],
    };

    const [first, second] = await Promise.all([
      service.createOrder(payload),
      service.createOrder(payload),
    ]);
    assert.equal(createOrderRecordCalls, 1);
    assert.strictEqual(first, second);

    const third = await service.createOrder(payload);
    assert.equal(createOrderRecordCalls, 2);
    assert.notStrictEqual(third, first);
  } finally {
    restore();
  }
});
