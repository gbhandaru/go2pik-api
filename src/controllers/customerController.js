const asyncHandler = require('../utils/asyncHandler');
const {
  createCustomerAdmin,
  findCustomerById,
  updateCustomer,
  deactivateCustomer,
} = require('../services/customerService');

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

const updateCustomerRecord = asyncHandler(async (req, res) => {
  const customer = await updateCustomer(req.params.id, req.body || {});
  res.json({ customer });
});

const deactivateCustomerRecord = asyncHandler(async (req, res) => {
  const customer = await deactivateCustomer(req.params.id);
  res.json({ customer });
});

module.exports = {
  createCustomer,
  getCustomer,
  updateCustomer: updateCustomerRecord,
  deactivateCustomer: deactivateCustomerRecord,
};
