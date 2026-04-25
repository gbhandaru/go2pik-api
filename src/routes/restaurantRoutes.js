const express = require('express');
const router = express.Router();
const { createRestaurant, listRestaurants, getRestaurantMenu } = require('../controllers/restaurantController');
const requireAdminDocsAuth = require('../middlewares/adminDocsAuth');

router.post('/', requireAdminDocsAuth, createRestaurant);
router.get('/', listRestaurants);
router.get('/:id/menu', getRestaurantMenu);

module.exports = router;
