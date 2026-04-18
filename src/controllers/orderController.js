const asyncHandler = require('../utils/asyncHandler');
const { createOrder, getOrderById, getOrders } = require('../services/orderService');
const {
  resolveAuthenticatedCustomer,
  mergeAuthenticatedCustomerPayload,
} = require('../utils/authenticatedCustomer');

const createOrderController = asyncHandler(async (req, res) => {
  const authCustomer = await resolveAuthenticatedCustomer(req);
  const payload = mergeAuthenticatedCustomerPayload(req.body || {}, authCustomer);
  const result = await createOrder(payload);
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

module.exports = {
  createOrder: createOrderController,
  listOrders: listOrdersController,
  getOrder: getOrderController,
};
