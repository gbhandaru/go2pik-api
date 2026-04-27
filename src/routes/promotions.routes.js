const express = require('express');
const router = express.Router();
const { validate } = require('../controllers/promotions.controller');

router.post('/validate', validate);

module.exports = router;
