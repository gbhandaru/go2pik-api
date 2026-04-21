const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const { getOrdersForRestaurant, getOrdersReportForRestaurant, updateStatus } = require('../services/dashboardService');

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

const acceptOrder = asyncHandler(async (req, res) => {
  const order = await updateStatus(req.params.orderId, 'accepted');
  res.json({ success: true, order });
});

const markPreparing = asyncHandler(async (req, res) => {
  const order = await updateStatus(req.params.orderId, 'preparing');
  res.json({ success: true, order });
});

const markReady = asyncHandler(async (req, res) => {
  const order = await updateStatus(req.params.orderId, 'ready_for_pickup');
  res.json({ success: true, order });
});

const completeOrder = asyncHandler(async (req, res) => {
  const order = await updateStatus(req.params.orderId, 'completed');
  res.json({ success: true, order });
});

const rejectOrder = asyncHandler(async (req, res) => {
  const { reject_reason: rejectReason } = req.body || {};
  if (!rejectReason) {
    throw ApiError.badRequest('reject_reason is required');
  }
  const order = await updateStatus(req.params.orderId, 'rejected', { rejectionReason: rejectReason });
  res.json({ success: true, order });
});

module.exports = {
  listOrders,
  ordersReport,
  acceptOrder,
  markPreparing,
  markReady,
  completeOrder,
  rejectOrder,
};
