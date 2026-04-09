const express = require('express');
const router = express.Router();
const {
  login,
  logout,
  refresh,
  profile,
} = require('../controllers/restaurantUserAuthController');

router.post('/restaurant-users/login', login);
router.post('/restaurant-users/logout', logout);
router.post('/restaurant-users/refresh', refresh);
router.get('/restaurant-users/me', profile);

module.exports = router;
