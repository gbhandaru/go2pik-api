const express = require('express');
const { twilioVerifyHealth } = require('../controllers/healthController');

const router = express.Router();

router.get('/twilio-verify', twilioVerifyHealth);

module.exports = router;
