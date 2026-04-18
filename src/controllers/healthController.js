const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const config = require('../config/env');
const { fetchTwilioAccountDetails } = require('../services/twilioSmsService');

const twilioVerifyHealth = asyncHandler(async (req, res) => {
  const { accountSid, authToken, phoneNumber } = config.twilio || {};
  if (!accountSid || !authToken || !phoneNumber) {
    throw ApiError.badRequest('Twilio SMS configuration is incomplete');
  }

  console.log('[healthController] twilio sms health check requested', {
    accountSid: accountSid ? `${accountSid.slice(0, 4)}...` : null,
  });

  const service = await fetchTwilioAccountDetails();
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.json({
    status: 'ok',
    service: 'twilio-sms',
    configured: true,
    reachable: true,
    otpLength: Number(config.verification?.otpLength || 6),
    serviceDetails: service,
  });
});

module.exports = {
  twilioVerifyHealth,
};
