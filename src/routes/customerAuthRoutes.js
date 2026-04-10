const express = require('express');
const router = express.Router();
const {
  register,
  login,
  logout,
  refresh,
  profile,
  updateProfile,
} = require('../controllers/customerAuthController');

router.post('/customers/signup', register);
router.post('/customers/login', login);
router.post('/customers/logout', logout);
router.post('/customers/refresh', refresh);
router.get('/customers/me', profile);
router.put('/customers/profile', updateProfile);

module.exports = router;
