const asyncHandler = require('../utils/asyncHandler');
const { createOrder, getOrderById } = require('../services/orderService');

const createOrderController = asyncHandler(async (req, res) => {
  const result = await createOrder(req.body || {});
  res.status(201).json({
    success: true,
    message: 'Order placed successfully',
    order: result.order,
    automation: result.automation,
  });
});

const getOrderController = asyncHandler(async (req, res) => {
  const order = await getOrderById(req.params.id);
  res.json({ success: true, order });
});

module.exports = {
  createOrder: createOrderController,
  getOrder: getOrderController,
};
