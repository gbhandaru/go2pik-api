const express = require('express');
const router = express.Router();
const {
  editRestaurantUser,
  deactivateRestaurantUser,
} = require('../controllers/restaurantUserController');

router.put('/:id', editRestaurantUser);
router.patch('/:id/deactivate', deactivateRestaurantUser);

module.exports = router;
