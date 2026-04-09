const express = require('express');
const router = express.Router();
const {
  createCustomer,
  getCustomer,
  updateCustomer,
  deactivateCustomer,
} = require('../controllers/customerController');

router.post('/', createCustomer);
router.get('/:id', getCustomer);
router.put('/:id', updateCustomer);
router.patch('/:id/deactivate', deactivateCustomer);

module.exports = router;
