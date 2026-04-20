const express = require('express');

const router = express.Router();
const {
  createCustomer,
  getCustomer,
  getCustomerOrders,
  updateCustomer,
  deactivateCustomer,
  sendWelcomeEmail,
} = require('../controllers/customerController');
const { updatePhone } = require('../controllers/customerAuthController');

router.post('/', createCustomer);
router.patch('/me/phone', updatePhone);
router.get('/:id/orders', getCustomerOrders);
router.get('/:id', getCustomer);
router.put('/:id', updateCustomer);
router.patch('/:id/deactivate', deactivateCustomer);
router.post('/:id/welcome-email', sendWelcomeEmail);

module.exports = router;
