const ApiError = require('../utils/errors');
const { formatUsd } = require('../utils/currency');
const {
  listOrdersForRestaurant,
  updateOrderStatus,
} = require('../repositories/orderRepository');

const SUPPORTED_ORDER_STATUSES = new Set([
  'new',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'completed',
  'rejected',
]);

const STATUS_TRANSITIONS = new Set([
  'accepted',
  'preparing',
  'ready_for_pickup',
  'completed',
  'rejected',
]);

const DASHBOARD_TIMEZONE = process.env.DASHBOARD_TIMEZONE || 'America/Los_Angeles';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function getDateStringInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function mapOrder(row) {
  const rawItems = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      notes: row.notes,
    },
    subtotal: Number(row.subtotal),
    tax: Number(row.tax_amount),
    total: Number(row.total_amount),
    createdAt: row.created_at,
    pickupTime: row.pickup_time,
    completedAt: row.completed_at,
    items: rawItems.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      price: Number(item.price),
      lineTotal: Number(item.lineTotal),
    })),
  };
}

function decorateOrder(order) {
  return {
    ...order,
    subtotalDisplay: formatUsd(order.subtotal),
    taxDisplay: formatUsd(order.tax),
    totalDisplay: formatUsd(order.total),
  };
}

async function getOrdersForRestaurant(restaurantId, filters = {}) {
  const rawStatus = filters.status;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : rawStatus;
  const completedDate =
    typeof filters.completedDate === 'string' && filters.completedDate.trim()
      ? filters.completedDate.trim()
      : null;
  const isCompletedToday = status === 'completedtoday';
  const effectiveStatus = isCompletedToday ? 'completed' : status;
  const effectiveCompletedDate =
    isCompletedToday || (effectiveStatus === 'completed' && !completedDate)
      ? completedDate || getDateStringInTimezone(new Date(), DASHBOARD_TIMEZONE)
      : completedDate;

  if (isCompletedToday && completedDate) {
    throw ApiError.badRequest('completedToday does not accept completedDate');
  }

  if (effectiveStatus && !SUPPORTED_ORDER_STATUSES.has(effectiveStatus)) {
    throw ApiError.badRequest(
      `Unsupported status: ${status}. Supported statuses: ${Array.from(SUPPORTED_ORDER_STATUSES).join(', ')}`
    );
  }

  if (effectiveCompletedDate && status !== 'completed') {
    if (!isCompletedToday) {
      throw ApiError.badRequest('completedDate can only be used with status=completed');
    }
  }
  if (effectiveCompletedDate && !ISO_DATE_RE.test(effectiveCompletedDate)) {
    throw ApiError.badRequest('completedDate must be in YYYY-MM-DD format');
  }

  const rows = await listOrdersForRestaurant(restaurantId, {
    status: effectiveStatus,
    completedDate: effectiveCompletedDate,
    timezone: DASHBOARD_TIMEZONE,
  });
  return rows.map(mapOrder).map(decorateOrder);
}

function buildStatusUpdate(nextStatus, options = {}) {
  if (!STATUS_TRANSITIONS.has(nextStatus)) {
    throw ApiError.badRequest(`Unsupported status: ${nextStatus}`);
  }
  const updates = { status: nextStatus };
  if (nextStatus === 'rejected') {
    updates.rejection_reason = options.rejectionReason || null;
    updates.rejected_at = new Date();
  } else if (nextStatus === 'ready_for_pickup') {
    updates.ready_at = new Date();
  } else if (nextStatus === 'completed') {
    updates.completed_at = new Date();
    updates.payment_status = 'paid_at_restaurant';
  } else if (nextStatus === 'preparing') {
    updates.accepted_at = options.acceptedAt || new Date();
  } else if (nextStatus === 'accepted') {
    updates.accepted_at = new Date();
  }
  return updates;
}

async function updateStatus(orderId, nextStatus, options = {}) {
  const updates = buildStatusUpdate(nextStatus, options);
  const row = await updateOrderStatus(orderId, updates);
  if (!row) {
    throw ApiError.notFound('Order not found');
  }
  return decorateOrder(mapOrder(row));
}

module.exports = {
  getOrdersForRestaurant,
  updateStatus,
  SUPPORTED_ORDER_STATUSES: Array.from(SUPPORTED_ORDER_STATUSES),
};
