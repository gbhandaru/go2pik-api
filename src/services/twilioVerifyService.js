const ApiError = require('../utils/errors');
const config = require('../config/env');

let twilioFactory = null;

function loadTwilio() {
  if (twilioFactory) {
    return twilioFactory;
  }
  try {
    twilioFactory = require('twilio');
    return twilioFactory;
  } catch (error) {
    throw ApiError.badRequest('Twilio SDK is not installed. Add the twilio package and retry.');
  }
}

function getVerifyServiceClient() {
  const { accountSid, authToken, verifyServiceSid } = config.twilio || {};
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw ApiError.badRequest('Twilio Verify is not configured');
  }
  const twilio = loadTwilio();
  const client = twilio(accountSid, authToken);
  return client.verify.v2.services(verifyServiceSid);
}

async function fetchVerifyServiceDetails() {
  const verifyService = getVerifyServiceClient();
  const service = await verifyService.fetch();
  return {
    sid: service.sid,
    friendlyName: service.friendlyName,
    accountSid: service.accountSid,
    codeLength: service.codeLength,
    ttl: service.ttl,
  };
}

module.exports = {
  getVerifyServiceClient,
  fetchVerifyServiceDetails,
};
