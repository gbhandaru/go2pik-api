const ApiError = require('../utils/errors');
const config = require('../config/env');
const { runOrderAutomation } = require('../utils/automation');
const { formatUsd } = require('../utils/currency');
const { normalizePhoneNumber } = require('../utils/phone');
const { normalizePromoCode, validatePromotion } = require('./promotions.service');
const { getRestaurantById } = require('./restaurantService');
const { findCustomerById } = require('./customerService');
const { sendOrderConfirmationEmail } = require('./notificationService');
const { validateScheduledPickupTime } = require('../utils/pickupHours');
const {
  createOrder: createOrderRecord,
  getOrderById: fetchOrderById,
  getOrderByOrderNumber: fetchOrderByOrderNumber,
  listOrders: fetchOrders,
  listOrdersForCustomer: fetchOrdersForCustomer,
  updateCustomerOrderAction,
} = require('../repositories/orderRepository');

const DEFAULT_TAX_RATE = Number(config.orders.defaultTaxRate || 0.08);
const SUPPORTED_ORDER_STATUSES = new Set([
  'new',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'completed',
  'rejected',
  'cancelled',
]);

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
      notes: item.notes || item.specialInstructions || item.special_instructions || null,
    };
  });
}

function enrichOrderRow(row) {
  if (!row) return row;
  const rawItems = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
  const items = rawItems.map((item) => ({
    id: item.id,
    ...item,
    quantity: Number(item.quantity),
    price: Number(item.price),
    lineTotal: Number(item.lineTotal),
    isAvailable: item.isAvailable !== undefined ? item.isAvailable : item.is_available !== undefined ? item.is_available : true,
    availabilityNote: item.availabilityNote || item.availability_note || null,
    markedUnavailableAt: item.markedUnavailableAt || item.marked_unavailable_at || null,
  }));
  const acceptedItems = items.filter((item) => item.isAvailable !== false);
  const unavailableItems = items.filter((item) => item.isAvailable === false);
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
    promotionId: row.promotion_id || null,
    promoCode: row.promo_code || null,
    discountAmount: Number(row.discount_amount || 0),
    finalAmount:
      row.final_amount !== null && row.final_amount !== undefined
        ? Number(row.final_amount)
        : Number(row.total_amount || 0),
    status: row.status,
    paymentMode: row.payment_mode,
    paymentStatus: row.payment_status,
    acceptedAt: row.accepted_at || null,
    acceptanceMode: row.acceptance_mode || 'full',
    kitchenNote: row.kitchen_note || null,
    customerAction: row.customer_action || 'none',
    customerActionAt: row.customer_action_at || null,
    customerActionNote: row.customer_action_note || null,
    acceptedItems,
    unavailableItems,
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
    totalDisplay: formatUsd(order.finalAmount ?? order.total),
    discountAmountDisplay: formatUsd(order.discountAmount ?? 0),
    finalAmountDisplay: formatUsd(order.finalAmount ?? order.total),
  };
}

async function createOrder(payload = {}) {
  const draft = await prepareOrderDraft(payload);
  const { restaurant, customer, items, totals } = draft;
  const { subtotal, tax, total } = totals;
  let promotion = null;
  if (draft.promoCode) {
    const validation = await validatePromotion({
      promoCode: draft.promoCode,
      customerPhone: customer.phone,
      orderAmount: total,
      restaurantId: restaurant.id,
    });
    if (!validation.valid) {
      throw ApiError.badRequest(validation.message || 'Promo code is invalid or already used');
    }
    promotion = validation;
  }
  const orderId = await createOrderRecord({
    restaurantId: restaurant.id,
    customer,
    items,
    totals,
    promotion: promotion
      ? {
          promotionId: promotion.promotionId,
          promoCode: promotion.promoCode,
          discountAmount: promotion.discountAmount,
          finalAmount: promotion.finalAmount,
          customerPhone: promotion.customerPhone || customer.phone || null,
        }
      : null,
  });
  const automationResult = await runOrderAutomation({
    restaurant,
    customer,
    items,
    subtotal,
    tax,
    total,
  });
  const persisted = await getOrderById(orderId);
  const notificationOrder = {
    ...persisted,
    customer: {
      ...(persisted.customer || {}),
      pickupDisplayTime: draft.customer?.pickupDisplayTime || null,
    },
    pickupRequest: draft.pickupRequest || payload.pickupRequest || null,
  };
  console.log('[orderService] preparing notification', {
    orderId,
    orderNumber: persisted.orderNumber,
    customerEmail: persisted.customer?.email,
    notificationsProvider: config.notifications.provider,
  });
  const notification = await sendOrderConfirmationEmail(notificationOrder);
  return {
    order: persisted,
    automation: automationResult,
    notification,
  };
}

async function prepareOrderDraft(payload = {}) {
  const { restaurantId, items = [], customer = {}, customerId: rootCustomerId } = payload;
  if (!restaurantId) {
    throw ApiError.badRequest('restaurantId is required');
  }
  const restaurant = await getRestaurantById(restaurantId);
  const normalizedItems = normalizeMenuItems(items, restaurant);
  const pickupTime = customer.pickupTime || customer.pickup_time || null;
  const pickupTypeHint = String(customer.pickupType || customer.pickup_type || '').trim().toUpperCase();
  const pickupType = pickupTypeHint === 'SCHEDULED' || pickupTime ? 'SCHEDULED' : 'ASAP';
  if (pickupType === 'SCHEDULED' && !pickupTime) {
    throw ApiError.validation('pickup_time_required', 'pickupTime is required for scheduled pickup');
  }
  if (pickupType === 'SCHEDULED' && pickupTime) {
    try {
      validateScheduledPickupTime(pickupTime, restaurant.pickupHours || restaurant.openHours || restaurant.hours || {});
    } catch (error) {
      if (error?.code === 'pickup_time_out_of_hours') {
        throw ApiError.validation(
          'pickup_time_out_of_hours',
          'Pickup time is outside restaurant open hours. Please choose another time.'
        );
      }
      if (error?.code === 'invalid_pickup_time') {
        throw ApiError.validation('invalid_pickup_time', 'pickupTime must be a valid ISO date-time');
      }
      throw error;
    }
  }
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const tax = Number((subtotal * DEFAULT_TAX_RATE).toFixed(2));
  const total = Number((subtotal + tax).toFixed(2));
  const derivedEmail = deriveEmailFromCustomer(customer);
  const rawCandidateId = customer.id || rootCustomerId || customer.customerId;
  const candidateCustomerId = rawCandidateId ? Number(rawCandidateId) : null;
  const normalizedPromoCode = normalizePromoCode(payload.promoCode);
  const normalizedCustomer = {
    ...customer,
    email: derivedEmail,
    pickupType,
    pickupTime,
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
  return {
    restaurantId: restaurant.id,
    restaurant,
    customer: normalizedCustomer,
    promoCode: normalizedPromoCode || null,
    customerId: candidateCustomerId,
    items: normalizedItems,
    totals: { subtotal, tax, total },
    pickupType,
    pickupTime,
    pickupRequest: payload.pickupRequest || null,
  };
}

async function getOrderById(orderId) {
  const row = await fetchOrderById(orderId);
  if (!row) {
    throw ApiError.notFound('Order not found');
  }
  return formatOrderAmounts(enrichOrderRow(row));
}

async function getOrderByNumber(orderNumber) {
  const row = await fetchOrderByOrderNumber(orderNumber);
  if (!row) {
    throw ApiError.notFound('Order not found');
  }
  return formatOrderAmounts(enrichOrderRow(row));
}

async function getOrders(filters = {}) {
  const rawStatus = filters.status;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : rawStatus;
  const rawRestaurantId = filters.restaurantId;
  const restaurantId =
    rawRestaurantId === null || rawRestaurantId === undefined || rawRestaurantId === ''
      ? null
      : Number(rawRestaurantId);

  if (restaurantId !== null && !Number.isFinite(restaurantId)) {
    throw ApiError.badRequest('restaurantId must be a number');
  }

  if (status && !SUPPORTED_ORDER_STATUSES.has(status)) {
    throw ApiError.badRequest(
      `Unsupported status: ${status}. Supported statuses: ${Array.from(SUPPORTED_ORDER_STATUSES).join(', ')}`
    );
  }
  const rows = await fetchOrders({
    status,
    restaurantId,
  });
  return rows.map(enrichOrderRow).map(formatOrderAmounts);
}

async function getOrdersForCustomer(customer = {}, filters = {}) {
  const rawStatus = filters.status;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : rawStatus;
  const rows = await fetchOrdersForCustomer({
    customerEmail: customer.email || null,
    customerPhone: customer.phone || null,
    status,
  });
  return rows.map(enrichOrderRow).map(formatOrderAmounts);
}

function orderMatchesCustomer(order, customer = {}) {
  const orderEmail = String(order.customer?.email || '').trim().toLowerCase();
  const customerEmail = String(customer.email || '').trim().toLowerCase();
  if (orderEmail && customerEmail && orderEmail === customerEmail) {
    return true;
  }
  const orderPhone = normalizePhoneNumber(order.customer?.phone || '');
  const customerPhone = normalizePhoneNumber(customer.phone || '');
  if (orderPhone && customerPhone && orderPhone === customerPhone) {
    return true;
  }
  return false;
}

async function acceptUpdatedOrder(orderId, customer = {}) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (!orderMatchesCustomer(order, customer)) {
    throw ApiError.forbidden('You are not authorized to access this order');
  }
  if (String(order.acceptanceMode || '').toLowerCase() !== 'partial') {
    throw ApiError.conflict('Customer action is only available for partially accepted orders');
  }
  if (String(order.status || '').toLowerCase() === 'cancelled') {
    throw ApiError.conflict('This order has already been cancelled');
  }
  const currentAction = String(order.customerAction || '').toLowerCase();
  if (currentAction === 'accepted') {
    return { order };
  }
  if (currentAction === 'cancelled') {
    throw ApiError.conflict('This order has already been cancelled');
  }
  if (currentAction !== 'pending' && currentAction !== 'none') {
    throw ApiError.conflict('This order is not waiting for customer action');
  }
  const updated = await updateCustomerOrderAction(orderId, {
    customer,
    action: 'accepted',
  });
  return { order: formatOrderAmounts(enrichOrderRow(updated)) };
}

async function cancelUpdatedOrder(orderId, customer = {}, note = null) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (!orderMatchesCustomer(order, customer)) {
    throw ApiError.forbidden('You are not authorized to access this order');
  }
  if (String(order.acceptanceMode || '').toLowerCase() !== 'partial') {
    throw ApiError.conflict('Customer action is only available for partially accepted orders');
  }
  const currentAction = String(order.customerAction || '').toLowerCase();
  if (String(order.status || '').toLowerCase() === 'cancelled' || currentAction === 'cancelled') {
    return { order };
  }
  if (currentAction === 'accepted') {
    throw ApiError.conflict('This order has already been accepted by the customer');
  }
  if (currentAction !== 'pending' && currentAction !== 'none') {
    throw ApiError.conflict('This order is not waiting for customer action');
  }
  const updated = await updateCustomerOrderAction(orderId, {
    customer,
    action: 'cancelled',
    note,
  });
  return { order: formatOrderAmounts(enrichOrderRow(updated)) };
}

module.exports = {
  createOrder,
  prepareOrderDraft,
  getOrderById,
  getOrderByNumber,
  getOrders,
  getOrdersForCustomer,
  acceptUpdatedOrder,
  cancelUpdatedOrder,
  SUPPORTED_ORDER_STATUSES: Array.from(SUPPORTED_ORDER_STATUSES),
};
