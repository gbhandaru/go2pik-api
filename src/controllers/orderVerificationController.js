const asyncHandler = require('../utils/asyncHandler');
const {
  startOrderVerification,
  confirmOrderVerification,
  resendOrderVerification,
  testOrderVerificationService,
} = require('../services/orderVerificationService');
const {
  resolveAuthenticatedCustomer,
  mergeAuthenticatedCustomerPayload,
} = require('../utils/authenticatedCustomer');

const start = asyncHandler(async (req, res) => {
  const authCustomer = await resolveAuthenticatedCustomer(req);
  const payload = mergeAuthenticatedCustomerPayload(req.body || {}, authCustomer);
  const result = await startOrderVerification(payload);
  res.status(201).json({
    success: true,
    message: 'OTP sent successfully',
    verification: result.verification,
  });
});

const confirm = asyncHandler(async (req, res) => {
  const { verificationId, verification_id: verificationIdAlt, code, otp } = req.body || {};
  const result = await confirmOrderVerification(verificationId || verificationIdAlt, code || otp);
  res.status(201).json({
    success: true,
    message: 'OTP verified and order placed successfully',
    verification: result.verification,
    order: result.order,
    automation: result.automation,
    notification: result.notification,
  });
});

const resend = asyncHandler(async (req, res) => {
  const { verificationId, verification_id: verificationIdAlt } = req.body || {};
  const result = await resendOrderVerification(verificationId || verificationIdAlt);
  res.json({
    success: true,
    message: 'OTP resent successfully',
    verification: result.verification,
  });
});

const test = asyncHandler(async (req, res) => {
  console.log('[orderVerificationController] Twilio Verify test requested', {
    hasPhone: Boolean(req.body?.phone || req.body?.customerPhone),
  });
  const result = await testOrderVerificationService(req.body || {});
  console.log('[orderVerificationController] Twilio Verify test result', {
    hasVerification: Boolean(result.verification),
    serviceSid: result.service?.sid || null,
    otpLength: result.service?.codeLength || null,
    ttl: result.service?.ttl || null,
  });
  res.json({
    success: true,
    message: result.verification ? 'Twilio Verify test OTP sent successfully' : 'Twilio Verify service is configured',
    service: result.service,
    verification: result.verification,
  });
});

module.exports = {
  start,
  confirm,
  resend,
  test,
};
