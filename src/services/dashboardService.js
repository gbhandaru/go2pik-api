const ApiError = require('../utils/errors');
const { formatUsd } = require('../utils/currency');
const {
  listOrdersForRestaurant,
  listOrdersForRestaurantReport,
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

function parseIsoDate(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) {
    throw ApiError.badRequest(`${fieldName} must be in YYYY-MM-DD format`);
  }
  return trimmed;
}

function getReportRange(filters = {}) {
  const today = getDateStringInTimezone(new Date(), DASHBOARD_TIMEZONE);
  const todayFlag = String(filters.today || '').toLowerCase() === 'true' || filters.today === true;
  const date = parseIsoDate(filters.date, 'date');
  const from = parseIsoDate(filters.from || filters.startDate, 'from');
  const to = parseIsoDate(filters.to || filters.endDate, 'to');

  if (date && (from || to)) {
    throw ApiError.badRequest('date cannot be combined with from/to');
  }

  if (todayFlag) {
    return { from: today, to: today };
  }

  if (date) {
    return { from: date, to: date };
  }

  if (!from && !to) {
    return { from: today, to: today };
  }

  return {
    from: from || to,
    to: to || from,
  };
}

function buildReportSummary(rows, range) {
  const statusCounts = {
    new: 0,
    accepted: 0,
    preparing: 0,
    ready_for_pickup: 0,
    completed: 0,
    rejected: 0,
  };
  const itemMap = new Map();
  let totalOrders = 0;
  let totalAmount = 0;
  let totalSubtotal = 0;

  rows.forEach((row) => {
    totalOrders += 1;
    totalAmount += Number(row.total_amount || 0);
    totalSubtotal += Number(row.subtotal || 0);
    const normalizedStatus = String(row.status || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(statusCounts, normalizedStatus)) {
      statusCounts[normalizedStatus] += 1;
    }

    const rawItems = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
    rawItems.forEach((item) => {
      const key = `${item.menuItemId ?? item.menu_item_id ?? item.name}`;
      const existing = itemMap.get(key) || {
        key,
        menuItemId: item.menuItemId ?? item.menu_item_id ?? null,
        name: item.name,
        quantity: 0,
        totalAmount: 0,
        unitPrice: Number(item.price || 0),
      };
      const quantity = Number(item.quantity || 0);
      const lineTotal = Number(item.lineTotal || item.line_total || 0);
      existing.quantity += quantity;
      existing.totalAmount += lineTotal;
      itemMap.set(key, existing);
    });
  });

  const items = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      totalAmount: Number(item.totalAmount.toFixed(2)),
      totalAmountDisplay: formatUsd(item.totalAmount),
    }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));

  return {
    range,
    timezone: DASHBOARD_TIMEZONE,
    totals: {
      orders: totalOrders,
      subtotal: Number(totalSubtotal.toFixed(2)),
      subtotalDisplay: formatUsd(totalSubtotal),
      amount: Number(totalAmount.toFixed(2)),
      amountDisplay: formatUsd(totalAmount),
    },
    statusCounts,
    items,
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

async function getOrdersReportForRestaurant(restaurantId, filters = {}) {
  const range = getReportRange(filters);
  const rows = await listOrdersForRestaurantReport(restaurantId, {
    createdFrom: range.from,
    createdTo: range.to,
    timezone: DASHBOARD_TIMEZONE,
  });
  return buildReportSummary(rows, range);
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
  getOrdersReportForRestaurant,
  updateStatus,
  SUPPORTED_ORDER_STATUSES: Array.from(SUPPORTED_ORDER_STATUSES),
};
