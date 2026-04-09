const express = require('express');
const router = express.Router();
const {
  listOrders,
  acceptOrder,
  markPreparing,
  markReady,
  completeOrder,
  rejectOrder,
} = require('../controllers/dashboardController');
const {
  listMenu,
  createMenuItem,
  updateMenuItem,
  toggleMenuAvailability,
} = require('../controllers/menuController');

router.get('/restaurants/:restaurantId/orders', listOrders);
router.patch('/orders/:orderId/accept', acceptOrder);
router.patch('/orders/:orderId/preparing', markPreparing);
router.patch('/orders/:orderId/ready', markReady);
router.patch('/orders/:orderId/complete', completeOrder);
router.patch('/orders/:orderId/reject', rejectOrder);
router.get('/restaurants/:restaurantId/menu', listMenu);
router.post('/restaurants/:restaurantId/menu', createMenuItem);
router.put('/menu-items/:menuItemId', updateMenuItem);
router.patch('/menu-items/:menuItemId/availability', toggleMenuAvailability);

module.exports = router;
