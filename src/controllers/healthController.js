const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const config = require('../config/env');
const { fetchVerifyServiceDetails } = require('../services/twilioVerifyService');

const twilioVerifyHealth = asyncHandler(async (req, res) => {
  const { accountSid, authToken, verifyServiceSid } = config.twilio || {};
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw ApiError.badRequest('Twilio Verify configuration is incomplete');
  }

  console.log('[healthController] twilio verify health check requested', {
    verifyServiceSid: verifyServiceSid ? `${verifyServiceSid.slice(0, 4)}...` : null,
  });

  const service = await fetchVerifyServiceDetails();
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
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
