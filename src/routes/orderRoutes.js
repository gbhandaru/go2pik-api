const express = require('express');
const router = express.Router();
const { createOrder, listOrders, getOrder } = require('../controllers/orderController');
const {
  start: startOrderVerification,
  confirm: confirmOrderVerification,
  resend: resendOrderVerification,
  test: testOrderVerification,
} = require('../controllers/orderVerificationController');

router.post('/', createOrder);
router.post('/verification/start', startOrderVerification);
router.post('/verification/confirm', confirmOrderVerification);
router.post('/verification/resend', resendOrderVerification);
router.post('/verification/test', testOrderVerification);
router.get('/', listOrders);
router.get('/:id', getOrder);

module.exports = router;
