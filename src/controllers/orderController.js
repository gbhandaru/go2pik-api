const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
  getOrderById,
  getOrderByNumber,
  getOrders,
  createOrder,
  acceptUpdatedOrder,
  cancelUpdatedOrder,
} = require('../services/orderService');
const { resolveAuthenticatedCustomer } = require('../utils/authenticatedCustomer');
const { verifyOrderReviewToken } = require('../utils/token');

const createOrderController = asyncHandler(async (req, res) => {
  const rawSmsConsent =
    req.body?.smsConsent ??
    req.body?.smsConsentAccepted ??
    req.body?.sms_consent ??
    false;
  const smsConsent = ['true', '1', 'yes', 'y', 'on'].includes(String(rawSmsConsent).trim().toLowerCase()) || rawSmsConsent === true || rawSmsConsent === 1;
  if (smsConsent) {
    throw ApiError.badRequest('smsConsent=true requires the OTP verification flow. Use /api/orders/verification/start.');
  }
  const result = await createOrder({
    ...req.body,
    smsConsent: false,
  });
  res.status(201).json({
    success: true,
    message: 'Order placed successfully',
    order: result.order,
    automation: result.automation,
    notification: result.notification,
  });
});

const listOrdersController = asyncHandler(async (req, res) => {
  const { status = null, restaurantId = null } = req.query || {};
  const orders = await getOrders({
    status: status || null,
    restaurantId: restaurantId || null,
  });
  res.json({ success: true, orders });
});

const getOrderController = asyncHandler(async (req, res) => {
  const order = await getOrderById(req.params.id);
  res.json({ success: true, order });
});

async function getRequiredAuthenticatedCustomer(req) {
  const customer = await resolveAuthenticatedCustomer(req);
  if (!customer) {
    throw ApiError.unauthorized('Authorization token missing or invalid');
  }
  return customer;
}

function getReviewToken(req) {
  return req.query?.token || req.body?.token || req.headers['x-order-review-token'] || null;
}

async function resolveOrderReviewContext(req, orderNumber) {
  const token = getReviewToken(req);
  if (!token) {
    throw ApiError.unauthorized('Order review token is required');
  }
  let payload;
  try {
    payload = verifyOrderReviewToken(token);
  } catch (error) {
    throw ApiError.unauthorized('Order review token is invalid or expired');
  }
  if (String(payload.orderNumber || '') !== String(orderNumber || '')) {
    throw ApiError.forbidden('Order review token does not match this order');
  }
  const order = await getOrderByNumber(orderNumber);
  if (String(payload.sub || '') !== String(order.id)) {
    throw ApiError.forbidden('Order review token does not match this order');
  }
  return {
    order,
    customer: {
      email: payload.email || order.customer?.email || null,
      phone: payload.phone || order.customer?.phone || null,
    },
    tokenPayload: payload,
  };
}

const acceptUpdatedOrderController = asyncHandler(async (req, res) => {
  const customer = await getRequiredAuthenticatedCustomer(req);
  const result = await acceptUpdatedOrder(req.params.id, customer);
  res.json({
    success: true,
    message: 'Updated order accepted successfully',
    order: result.order,
  });
});

const cancelUpdatedOrderController = asyncHandler(async (req, res) => {
  const customer = await getRequiredAuthenticatedCustomer(req);
  const note = req.body?.note || req.body?.reason || null;
  const result = await cancelUpdatedOrder(req.params.id, customer, note);
  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order: result.order,
  });
});

const getOrderReviewController = asyncHandler(async (req, res) => {
  const { order, tokenPayload } = await resolveOrderReviewContext(req, req.params.orderNumber);
  res.json({
    success: true,
    order,
    review: {
      orderNumber: order.orderNumber,
      tokenType: tokenPayload.type,
      canAccept: String(order.acceptanceMode || '').toLowerCase() === 'partial'
        && String(order.customerAction || '').toLowerCase() === 'pending',
      canCancel: String(order.acceptanceMode || '').toLowerCase() === 'partial'
        && String(order.customerAction || '').toLowerCase() === 'pending',
    },
  });
});

const acceptUpdatedOrderReviewController = asyncHandler(async (req, res) => {
  const { order, customer } = await resolveOrderReviewContext(req, req.params.orderNumber);
  const result = await acceptUpdatedOrder(order.id, customer);
  res.json({
    success: true,
    message: 'Updated order accepted successfully',
    order: result.order,
  });
});

const cancelUpdatedOrderReviewController = asyncHandler(async (req, res) => {
  const { order, customer } = await resolveOrderReviewContext(req, req.params.orderNumber);
  const note = req.body?.note || req.body?.reason || null;
  const result = await cancelUpdatedOrder(order.id, customer, note);
  res.json({
    success: true,
    message: 'Order cancelled successfully',
    order: result.order,
  });
});

module.exports = {
  createOrder: createOrderController,
  listOrders: listOrdersController,
  getOrder: getOrderController,
  acceptUpdatedOrder: acceptUpdatedOrderController,
  cancelUpdatedOrder: cancelUpdatedOrderController,
  getOrderReview: getOrderReviewController,
  acceptUpdatedOrderReview: acceptUpdatedOrderReviewController,
  cancelUpdatedOrderReview: cancelUpdatedOrderReviewController,
};
