const asyncHandler = require('../utils/asyncHandler');
const { createOrder, getOrderById } = require('../services/orderService');
const { verifyAccessToken } = require('../utils/token');
const { findCustomerById } = require('../services/customerService');

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

async function resolveAuthenticatedCustomer(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }
  try {
    const payload = verifyAccessToken(token, 'customer');
    const customer = await findCustomerById(Number(payload.sub));
    if (!customer) {
      console.warn('[orderController] authenticated customer not found', { customerId: payload.sub });
      return null;
    }
    return customer;
  } catch (error) {
    console.warn('[orderController] failed to resolve authenticated customer', { error: error.message });
    return null;
  }
}

const createOrderController = asyncHandler(async (req, res) => {
  const authCustomer = await resolveAuthenticatedCustomer(req);
  const body = req.body || {};
  const mergedCustomer = { ...(body.customer || {}) };
  const payload = { ...body };
  if (authCustomer) {
    mergedCustomer.id = authCustomer.id;
    mergedCustomer.email = mergedCustomer.email || authCustomer.email;
    mergedCustomer.name = mergedCustomer.name || authCustomer.full_name;
    mergedCustomer.phone = mergedCustomer.phone || authCustomer.phone;
    payload.customerId = authCustomer.id;
  }
  payload.customer = mergedCustomer;
  const result = await createOrder(payload);
  res.status(201).json({
    success: true,
    message: 'Order placed successfully',
    order: result.order,
    automation: result.automation,
    notification: result.notification,
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
