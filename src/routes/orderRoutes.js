const express = require('express');
const router = express.Router();
const { createOrder, listOrders, getOrder } = require('../controllers/orderController');

router.post('/', createOrder);
router.get('/', listOrders);
router.get('/:id', getOrder);

module.exports = router;
