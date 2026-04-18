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

function getTwilioClient() {
  const { accountSid, authToken } = config.twilio || {};
  if (!accountSid || !authToken) {
    throw ApiError.badRequest('Twilio configuration is incomplete');
  }
  const twilio = loadTwilio();
  return twilio(accountSid, authToken);
}

async function fetchTwilioAccountDetails() {
  const { accountSid } = config.twilio || {};
  if (!accountSid) {
    throw ApiError.badRequest('Twilio configuration is incomplete');
  }
  const client = getTwilioClient();
  const account = await client.api.v2010.accounts(accountSid).fetch();
  return {
    sid: account.sid,
    friendlyName: account.friendlyName,
    status: account.status,
    type: account.type,
  };
}

async function sendSms({ to, body }) {
  const { phoneNumber } = config.twilio || {};
  if (!phoneNumber) {
    throw ApiError.badRequest('TWILIO_PHONE_NUMBER is not configured');
  }
  const client = getTwilioClient();
  return client.messages.create({
    from: phoneNumber,
    to,
    body,
  });
}

module.exports = {
  getTwilioClient,
  fetchTwilioAccountDetails,
  sendSms,
};
