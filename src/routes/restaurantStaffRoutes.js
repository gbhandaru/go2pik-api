const express = require('express');
const router = express.Router();
const {
  createUserForRestaurant,
  listUsersForRestaurant,
} = require('../controllers/restaurantUserController');

router.post('/:restaurantId/users', createUserForRestaurant);
router.get('/:restaurantId/users', listUsersForRestaurant);

module.exports = router;
