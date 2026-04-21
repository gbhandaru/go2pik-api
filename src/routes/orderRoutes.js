const express = require('express');
const router = express.Router();
const {
  createOrder,
  listOrders,
  getOrder,
  acceptUpdatedOrder,
  cancelUpdatedOrder,
  getOrderReview,
  acceptUpdatedOrderReview,
  cancelUpdatedOrderReview,
} = require('../controllers/orderController');
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
router.get('/review/:orderNumber', getOrderReview);
router.patch('/review/:orderNumber/accept-updated', acceptUpdatedOrderReview);
router.patch('/review/:orderNumber/cancel', cancelUpdatedOrderReview);
router.patch('/:id/accept-updated', acceptUpdatedOrder);
router.patch('/:id/cancel', cancelUpdatedOrder);
router.get('/:id', getOrder);

module.exports = router;
