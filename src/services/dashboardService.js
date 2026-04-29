const ApiError = require('../utils/errors');
const config = require('../config/env');
const { formatUsd } = require('../utils/currency');
const { sendPartialAcceptanceSms } = require('./notificationService');
const {
  listOrdersForRestaurant,
  listOrdersForRestaurantReport,
  partiallyAcceptOrder,
  updateOrderStatus,
} = require('../repositories/orderRepository');

const SUPPORTED_ORDER_STATUSES = new Set([
  'new',
  'accepted',
  'preparing',
  'ready_for_pickup',
  'completed',
  'rejected',
  'cancelled',
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
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    smsConsent: Boolean(row.sms_consent),
    smsConsentAt: row.sms_consent_at || null,
    smsConsentPhone: row.sms_consent_phone || null,
    smsConsentText: row.sms_consent_text || null,
    smsConsentVersion: row.sms_consent_version || null,
    smsOptInSource: row.sms_opt_in_source || null,
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
    acceptedAt: row.accepted_at || null,
    acceptanceMode: row.acceptance_mode || 'full',
    kitchenNote: row.kitchen_note || null,
    customerAction: row.customer_action || 'none',
    customerActionAt: row.customer_action_at || null,
    customerActionNote: row.customer_action_note || null,
    items,
    acceptedItems: items.filter((item) => item.isAvailable !== false),
    unavailableItems: items.filter((item) => item.isAvailable === false),
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
    cancelled: 0,
  };
  const itemMap = new Map();
  const dailySeriesMap = new Map();
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

    const createdDate = row.created_at
      ? getDateStringInTimezone(new Date(row.created_at), DASHBOARD_TIMEZONE)
      : null;
    if (createdDate) {
      const existing = dailySeriesMap.get(createdDate) || {
        date: createdDate,
        orders: 0,
        amount: 0,
      };
      existing.orders += 1;
      existing.amount += Number(row.total_amount || 0);
      dailySeriesMap.set(createdDate, existing);
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

  function buildDateSeries(startDate, endDate) {
    if (!startDate || !endDate) {
      return [];
    }
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const series = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const dateKey = cursor.toISOString().slice(0, 10);
      const point = dailySeriesMap.get(dateKey) || {
        date: dateKey,
        orders: 0,
        amount: 0,
      };
      series.push({
        date: point.date,
        orders: point.orders,
        amount: Number(point.amount.toFixed(2)),
        amountDisplay: formatUsd(point.amount),
        avgOrder: point.orders > 0 ? Number((point.amount / point.orders).toFixed(2)) : 0,
      });
    }
    return series;
  }

  const graphSeries = buildDateSeries(range.from, range.to);
  const avgOrder = totalOrders > 0 ? Number((totalAmount / totalOrders).toFixed(2)) : 0;
  const pendingOrders =
    (statusCounts.new || 0) +
    (statusCounts.accepted || 0) +
    (statusCounts.preparing || 0) +
    (statusCounts.ready_for_pickup || 0);
  const commissionRate = Number(config.reports?.defaultCommissionRate || 0);
  const commissionAmount = Number((totalAmount * commissionRate).toFixed(2));
  const restaurantNetAmount = Number((totalAmount - commissionAmount).toFixed(2));

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
    avgOrder,
    avgOrderDisplay: formatUsd(avgOrder),
    pendingOrders,
    commissionRate,
    commissionAmount,
    commissionAmountDisplay: formatUsd(commissionAmount),
    restaurantNetAmount,
    restaurantNetAmountDisplay: formatUsd(restaurantNetAmount),
    statusCounts,
    graphSeries,
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

function normalizePartialAcceptItemId(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function extractItemIds(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) =>
      normalizePartialAcceptItemId(
        item?.id ?? item?.orderItemId ?? item?.order_item_id ?? item?.menuItemId ?? item?.menu_item_id
      )
    )
    .filter((value) => value !== null);
}

function normalizeIds(values = []) {
  return (Array.isArray(values) ? values : [])
    .map(normalizePartialAcceptItemId)
    .filter((value) => value !== null);
}

function uniqueIds(values = []) {
  return Array.from(new Set(normalizeIds(values)));
}

function findDuplicateIds(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  normalizeIds(values).forEach((id) => {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  });
  return Array.from(duplicates);
}

function validateMatchingIdSets(acceptedIds, unavailableIds, acceptedItems, rejectedItems) {
  const acceptedItemIds = uniqueIds(extractItemIds(acceptedItems));
  const rejectedItemIds = uniqueIds(extractItemIds(rejectedItems));
  if (acceptedItemIds.length > 0 && acceptedItemIds.some((id) => !acceptedIds.includes(id))) {
    throw ApiError.validation(
      'partial_accept_item_payload_mismatch',
      'accepted_items does not match accepted_item_ids'
    );
  }
  if (rejectedItemIds.length > 0 && rejectedItemIds.some((id) => !unavailableIds.includes(id))) {
    throw ApiError.validation(
      'partial_accept_item_payload_mismatch',
      'rejected_items does not match unavailable_item_ids'
    );
  }
}

async function partiallyAcceptOrderForRestaurant(orderId, payload = {}) {
  const hasAcceptedIdField =
    Object.prototype.hasOwnProperty.call(payload, 'accepted_item_ids') ||
    Object.prototype.hasOwnProperty.call(payload, 'acceptedItemIds');
  const hasUnavailableIdField =
    Object.prototype.hasOwnProperty.call(payload, 'unavailable_item_ids') ||
    Object.prototype.hasOwnProperty.call(payload, 'unavailableItemIds');

  const acceptedIdsRaw = hasAcceptedIdField
    ? payload.accepted_item_ids || payload.acceptedItemIds || []
    : payload.accepted_items || payload.acceptedItems || [];
  const unavailableIdsRaw = hasUnavailableIdField
    ? payload.unavailable_item_ids || payload.unavailableItemIds || []
    : payload.rejected_items || payload.rejectedItems || [];

  const acceptedDuplicates = findDuplicateIds(acceptedIdsRaw);
  const unavailableDuplicates = findDuplicateIds(unavailableIdsRaw);
  if (acceptedDuplicates.length > 0 || unavailableDuplicates.length > 0) {
    throw ApiError.validation(
      'partial_accept_duplicate_item_ids',
      'Duplicate item ids are not allowed',
      {
        acceptedDuplicateIds: acceptedDuplicates,
        unavailableDuplicateIds: unavailableDuplicates,
      }
    );
  }

  const acceptedIds = uniqueIds(acceptedIdsRaw);
  const unavailableIds = uniqueIds(unavailableIdsRaw);
  const acceptedItems = payload.accepted_items || payload.acceptedItems || [];
  const rejectedItems = payload.rejected_items || payload.rejectedItems || [];
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';

  validateMatchingIdSets(acceptedIds, unavailableIds, acceptedItems, rejectedItems);

  const order = await partiallyAcceptOrder(orderId, {
    acceptedItemIds: acceptedIds,
    unavailableItemIds: unavailableIds,
    note,
    taxRate: Number(config.orders.defaultTaxRate || 0.08),
  });
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  const decoratedOrder = decorateOrder(mapOrder(order));
  let notification = { delivered: false, skipped: true, reason: 'not_attempted' };
  try {
    notification = await sendPartialAcceptanceSms(decoratedOrder);
  } catch (error) {
    notification = {
      delivered: false,
      skipped: false,
      reason: 'provider_error',
      error: error.message,
    };
    console.error('[dashboardService] partial acceptance SMS failed', {
      orderId,
      orderNumber: decoratedOrder.orderNumber,
      error: error.message,
      responseBody: error.responseBody,
      statusCode: error.statusCode,
    });
  }
  return {
    order: decoratedOrder,
    notification,
  };
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
  partiallyAcceptOrderForRestaurant,
  updateStatus,
  SUPPORTED_ORDER_STATUSES: Array.from(SUPPORTED_ORDER_STATUSES),
};
