const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const { getOrderById, getOrders } = require('../services/orderService');

const createOrderController = asyncHandler(async (req, res) => {
  throw ApiError.forbidden('Direct order creation is disabled. Use /api/orders/verification/start and /confirm.');
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

module.exports = {
  createOrder: createOrderController,
  listOrders: listOrdersController,
  getOrder: getOrderController,
};
