const asyncHandler = require('../utils/asyncHandler');
const {
  createCustomerAdmin,
  findCustomerById,
  updateCustomer,
  deactivateCustomer,
} = require('../services/customerService');
const { getOrdersForCustomer } = require('../services/orderService');
const { sendWelcomeEmail } = require('../services/notificationService');

const createCustomer = asyncHandler(async (req, res) => {
  const customer = await createCustomerAdmin(req.body || {});
  res.status(201).json({ customer });
});

const getCustomer = asyncHandler(async (req, res) => {
  const customer = await findCustomerById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }
  res.json({ customer });
});

const getCustomerOrders = asyncHandler(async (req, res) => {
  const customer = await findCustomerById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }
  const orders = await getOrdersForCustomer(customer, req.query || {});
  res.json({ customer, orders });
});

const updateCustomerRecord = asyncHandler(async (req, res) => {
  const customer = await updateCustomer(req.params.id, req.body || {});
  res.json({ customer });
});

const deactivateCustomerRecord = asyncHandler(async (req, res) => {
  const customer = await deactivateCustomer(req.params.id);
  res.json({ customer });
});

const sendWelcomeEmailController = asyncHandler(async (req, res) => {
  const customer = await findCustomerById(req.params.id);
  if (!customer) {
    return res.status(404).json({ message: 'Customer not found' });
  }
  const notification = await sendWelcomeEmail(customer);
  const statusCode = notification.delivered ? 200 : 400;
  res.status(statusCode).json({
    message: notification.delivered
      ? 'Welcome email sent'
      : `Welcome email not sent: ${notification.reason || 'unknown_reason'}`,
    notification,
  });
});

module.exports = {
  createCustomer,
  getCustomer,
  getCustomerOrders,
  updateCustomer: updateCustomerRecord,
  deactivateCustomer: deactivateCustomerRecord,
  sendWelcomeEmail: sendWelcomeEmailController,
};
