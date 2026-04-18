const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const config = require('../config/env');
const { fetchVerifyServiceDetails } = require('../services/twilioVerifyService');

const twilioVerifyHealth = asyncHandler(async (req, res) => {
  const { accountSid, authToken, verifyServiceSid } = config.twilio || {};
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw ApiError.badRequest('Twilio Verify configuration is incomplete');
  }

  const service = await fetchVerifyServiceDetails();
  res.json({
    status: 'ok',
    service: 'twilio-verify',
    configured: true,
    reachable: true,
    otpLength: Number(config.verification?.otpLength || 6),
    serviceDetails: service,
  });
});

module.exports = {
  twilioVerifyHealth,
};
