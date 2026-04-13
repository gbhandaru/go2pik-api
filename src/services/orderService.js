const ApiError = require('../utils/errors');
const config = require('../config/env');
const { runOrderAutomation } = require('../utils/automation');
const { formatUsd } = require('../utils/currency');
const { getRestaurantById } = require('./restaurantService');
const { findCustomerById } = require('./customerService');
const { sendOrderConfirmationEmail } = require('./notificationService');
const {
  createOrder: createOrderRecord,
  getOrderById: fetchOrderById,
} = require('../repositories/orderRepository');

const DEFAULT_TAX_RATE = Number(config.orders.defaultTaxRate || 0.08);

function deriveEmailFromCustomer(customer = {}) {
  const candidates = [customer.email, customer.username, customer.name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed && trimmed.includes('@')) {
        return trimmed.toLowerCase();
      }
    }
  }
  return null;
}

function normalizeMenuItems(items, restaurant) {
  if (!Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('At least one item is required');
  }
  return items.map((item) => {
    const sku = item.sku || item.name;
    const menuItem = (restaurant.menu || []).find(
      (entry) => entry.sku === sku || entry.name.toLowerCase() === (item.name || '').toLowerCase()
    );
    if (!menuItem) {
      const missingLabel = item.name || item.sku || 'unknown item';
      throw ApiError.badRequest(`${missingLabel} is not on ${restaurant.name}'s menu`);
    }
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const price = Number(menuItem.price);
    const lineTotal = Number((quantity * price).toFixed(2));
    return {
      id: menuItem.id,
      sku: menuItem.sku,
      name: menuItem.name,
      quantity,
      price,
      lineTotal,
      notes: item.notes || null,
    };
  });
}

function enrichOrderRow(row) {
  if (!row) return row;
  const rawItems = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
  const items = rawItems.map((item) => ({
    ...item,
    quantity: Number(item.quantity),
    price: Number(item.price),
    lineTotal: Number(item.lineTotal),
  }));
  return {
    id: row.id,
    orderNumber: row.order_number,
    restaurant: {
      id: row.restaurant_id,
      name: row.restaurant_name,
      cuisine: row.cuisine_type,
      location: [row.city, row.state].filter(Boolean).join(', '),
    },
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email,
      pickupTime: row.pickup_time,
      notes: row.notes,
    },
    items,
    subtotal: Number(row.subtotal),
    tax: Number(row.tax_amount),
    total: Number(row.total_amount),
    status: row.status,
    paymentMode: row.payment_mode,
    paymentStatus: row.payment_status,
  };
}

function formatOrderAmounts(order) {
  if (!order) return order;
  return {
    ...order,
    items: (order.items || []).map((item) => ({
      ...item,
      priceDisplay: formatUsd(item.price),
      lineTotalDisplay: formatUsd(item.lineTotal),
    })),
    subtotalDisplay: formatUsd(order.subtotal ?? order.total),
    taxDisplay: formatUsd(order.tax ?? 0),
    totalDisplay: formatUsd(order.total),
  };
}

async function createOrder(payload = {}) {
  const { restaurantId, items = [], customer = {}, customerId: rootCustomerId } = payload;
  if (!restaurantId) {
    throw ApiError.badRequest('restaurantId is required');
  }
  const restaurant = await getRestaurantById(restaurantId);
  const normalizedItems = normalizeMenuItems(items, restaurant);
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = Number((subtotal * DEFAULT_TAX_RATE).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  const derivedEmail = deriveEmailFromCustomer(customer);
  const rawCandidateId = customer.id || rootCustomerId || customer.customerId;
  const candidateCustomerId = rawCandidateId ? Number(rawCandidateId) : null;
  const normalizedCustomer = {
    ...customer,
    email: derivedEmail,
  };
  if (!customer.email) {
    if (derivedEmail) {
      console.log('[orderService] derived customer email for notification', {
        sourceFields: {
          usernamePresent: Boolean(customer.username),
          nameLooksLikeEmail: typeof customer.name === 'string' && customer.name.includes('@'),
        },
      });
    } else if (Number.isFinite(candidateCustomerId)) {
      const dbCustomer = await findCustomerById(candidateCustomerId);
      if (dbCustomer?.email) {
        normalizedCustomer.email = dbCustomer.email;
        normalizedCustomer.name = normalizedCustomer.name || dbCustomer.full_name;
        normalizedCustomer.phone = normalizedCustomer.phone || dbCustomer.phone;
        console.log('[orderService] hydrated customer contact info from DB', {
          customerId: candidateCustomerId,
          emailPresent: true,
        });
      } else if (dbCustomer) {
        console.warn('[orderService] customer record missing email', {
          customerId: candidateCustomerId,
        });
      } else {
        console.warn('[orderService] customer id referenced but not found', {
          customerId: candidateCustomerId,
        });
      }
    } else {
      console.warn('[orderService] customer email missing and could not be derived', {
        customerName: customer.name,
      });
    }
  }
  const orderId = await createOrderRecord({
    restaurantId: restaurant.id,
    customer: normalizedCustomer,
    items: normalizedItems,
    totals: { subtotal, tax, total },
  });
  const automationResult = await runOrderAutomation({
    restaurant,
    customer,
    items: normalizedItems,
    subtotal,
    tax,
    total,
  });
  const persisted = await getOrderById(orderId);
  console.log('[orderService] preparing notification', {
    orderId,
    orderNumber: persisted.orderNumber,
    customerEmail: persisted.customer?.email,
    notificationsProvider: config.notifications.provider,
  });
  const notification = await sendOrderConfirmationEmail(persisted);
  return {
    order: persisted,
    automation: automationResult,
    notification,
  };
}

async function getOrderById(orderId) {
  const row = await fetchOrderById(orderId);
  if (!row) {
    throw ApiError.notFound('Order not found');
  }
  return formatOrderAmounts(enrichOrderRow(row));
}

module.exports = {
  createOrder,
  getOrderById,
};
