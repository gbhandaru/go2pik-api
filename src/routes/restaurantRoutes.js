const express = require('express');
const router = express.Router();
const { listRestaurants, getRestaurantMenu } = require('../controllers/restaurantController');

router.get('/', listRestaurants);
router.get('/:id/menu', getRestaurantMenu);

module.exports = router;
