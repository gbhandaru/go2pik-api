const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
  getOrdersForRestaurant,
  getOrdersReportForRestaurant,
  partiallyAcceptOrderForRestaurant,
  updateStatus,
} = require('../services/dashboardService');

const listOrders = asyncHandler(async (req, res) => {
  const { status = null, completedDate = null, restaurantId: restaurantIdQuery = null } = req.query || {};
  const restaurantId = req.params.restaurantId || restaurantIdQuery;
  if (!restaurantId) {
    throw ApiError.badRequest('restaurantId is required');
  }
  const orders = await getOrdersForRestaurant(restaurantId, {
    status: status || null,
    completedDate: completedDate || null,
  });
  res.json({ success: true, orders });
});

const ordersReport = asyncHandler(async (req, res) => {
  const restaurantId = req.params.restaurantId || null;
  if (!restaurantId) {
    throw ApiError.badRequest('restaurantId is required');
  }
  const report = await getOrdersReportForRestaurant(restaurantId, req.query || {});
  res.json({ success: true, report });
});

const partialAcceptOrder = asyncHandler(async (req, res) => {
  const result = await partiallyAcceptOrderForRestaurant(req.params.orderId, req.body || {});
  res.json({
    success: true,
    message: 'Order partially accepted successfully',
    order: result.order,
    notification: result.notification || null,
  });
});

const acceptOrder = asyncHandler(async (req, res) => {
  const result = await updateStatus(req.params.orderId, 'accepted');
  res.json({ success: true, order: result.order, notification: result.notification || null });
});

const markPreparing = asyncHandler(async (req, res) => {
  const result = await updateStatus(req.params.orderId, 'preparing');
  res.json({ success: true, order: result.order, notification: result.notification || null });
});

const markReady = asyncHandler(async (req, res) => {
  const result = await updateStatus(req.params.orderId, 'ready_for_pickup');
  res.json({
    success: true,
    order: result.order,
    notification: result.notification || null,
  });
});

const completeOrder = asyncHandler(async (req, res) => {
  const result = await updateStatus(req.params.orderId, 'completed');
  res.json({ success: true, order: result.order, notification: result.notification || null });
});

const rejectOrder = asyncHandler(async (req, res) => {
  const { reject_reason: rejectReason } = req.body || {};
  if (!rejectReason) {
    throw ApiError.badRequest('reject_reason is required');
  }
  const result = await updateStatus(req.params.orderId, 'rejected', { rejectionReason: rejectReason });
  res.json({ success: true, order: result.order, notification: result.notification || null });
});

module.exports = {
  listOrders,
  ordersReport,
  partialAcceptOrder,
  acceptOrder,
  markPreparing,
  markReady,
  completeOrder,
  rejectOrder,
};
