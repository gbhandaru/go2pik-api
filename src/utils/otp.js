const crypto = require('crypto');
const config = require('../config/env');

function getOtpSecret() {
  return config.auth?.accessTokenSecret || 'dev-access-secret';
}

function generateOtp(length = 6) {
  const digits = Math.max(4, Number(length) || 6);
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

function hashOtp(otp) {
  return crypto.createHmac('sha256', getOtpSecret()).update(String(otp)).digest('hex');
}

function verifyOtp(otp, hash) {
  if (!otp || !hash) {
    return false;
  }
  const expected = hashOtp(otp);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(String(hash), 'hex');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
};
