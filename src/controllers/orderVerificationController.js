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
  const rawPhone = req.body?.customer?.phone || req.body?.phone || req.body?.customerPhone || null;
  console.log('[orderVerificationController] verification start requested', {
    hasCustomer: Boolean(req.body?.customer),
    hasItems: Array.isArray(req.body?.items),
    restaurantId: req.body?.restaurantId || null,
    rawPhonePresent: Boolean(rawPhone),
    rawPhoneMasked: rawPhone ? `***${String(rawPhone).replace(/\D/g, '').slice(-4)}` : null,
    bodyKeys: Object.keys(req.body || {}),
  });
  const authCustomer = await resolveAuthenticatedCustomer(req);
  const payload = mergeAuthenticatedCustomerPayload(req.body || {}, authCustomer);
  console.log('[orderVerificationController] verification start merged payload', {
    restaurantId: payload.restaurantId || null,
    customerPhonePresent: Boolean(payload.customer?.phone),
    customerPhoneMasked: payload.customer?.phone ? `***${String(payload.customer.phone).replace(/\D/g, '').slice(-4)}` : null,
    customerKeys: Object.keys(payload.customer || {}),
  });
  const result = await startOrderVerification(payload);
  console.log('[orderVerificationController] verification start response ready', {
    verificationId: result?.verification?.id || null,
    status: result?.verification?.status || null,
    customerPhoneMasked: result?.verification?.maskedPhone || null,
    twilioVerificationSid: result?.verification?.twilioVerificationSid || null,
    expiresAt: result?.verification?.expiresAt || null,
    resendAvailableAt: result?.verification?.resendAvailableAt || null,
    orderNumber: result?.order?.orderNumber || null,
  });
  res.status(201).json({
    success: true,
    message: result.verification ? 'OTP sent successfully' : 'Order placed successfully without SMS consent',
    verification: result.verification,
    order: result.order || null,
    automation: result.automation || null,
    notification: result.notification || null,
    twilioVerification: result.twilioVerification || null,
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
    twilioVerification: result.twilioVerification || null,
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
