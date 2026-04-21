const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  listOrders,
  ordersReport,
  acceptOrder,
  markPreparing,
  markReady,
  completeOrder,
  rejectOrder,
} = require('../controllers/dashboardController');
const {
  listMenu,
  listMenuCategories,
  createMenuItem,
  updateMenuItem,
  toggleMenuAvailability,
  deleteMenuItem,
  createMenuCategory,
  updateMenuCategory,
  exportMenu,
  importMenu,
} = require('../controllers/menuController');

const upload = multer({
  storage: multer.memoryStorage(),
});

router.get('/restaurants/:restaurantId/orders', listOrders);
router.get('/restaurants/:restaurantId/reports/orders', ordersReport);
router.patch('/orders/:orderId/accept', acceptOrder);
router.patch('/orders/:orderId/preparing', markPreparing);
router.patch('/orders/:orderId/ready', markReady);
router.patch('/orders/:orderId/complete', completeOrder);
router.patch('/orders/:orderId/reject', rejectOrder);
router.get('/restaurants/:restaurantId/menu', listMenu);
router.get('/restaurants/:restaurantId/menu/categories', listMenuCategories);
router.get('/restaurants/:restaurantId/menu/export', exportMenu);
router.post(
  '/restaurants/:restaurantId/menu/import',
  express.text({ type: ['text/csv', 'application/csv', 'text/plain'] }),
  upload.any(),
  importMenu
);
router.post('/restaurants/:restaurantId/menu', createMenuItem);
router.post('/restaurants/:restaurantId/menu/categories', createMenuCategory);
router.put('/restaurants/:restaurantId/menu/categories/:categoryId', updateMenuCategory);
router.put('/menu-items/:menuItemId', updateMenuItem);
router.patch('/menu-items/:menuItemId/availability', toggleMenuAvailability);
router.delete('/menu-items/:menuItemId', deleteMenuItem);

module.exports = router;
