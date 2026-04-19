const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const config = require('../config/env');
const { getTwilioClient } = require('../services/twilioSmsService');

const twilioVerifyHealth = asyncHandler(async (req, res) => {
  const { accountSid, authToken, verifyServiceSid } = config.twilio || {};
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw ApiError.badRequest('Twilio Verify configuration is incomplete');
  }

  console.log('[healthController] twilio verify health check requested', {
    accountSid: accountSid ? `${accountSid.slice(0, 4)}...` : null,
  });

  const client = getTwilioClient();
  const service = await client.verify.v2.services(verifyServiceSid).fetch();
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
    otpLength: Number(service.codeLength || config.verification?.otpLength || 6),
    serviceDetails: {
      sid: service.sid,
      friendlyName: service.friendlyName,
      accountSid: service.accountSid,
      codeLength: service.codeLength,
      ttl: service.ttl,
    },
  });
});

module.exports = {
  twilioVerifyHealth,
};
