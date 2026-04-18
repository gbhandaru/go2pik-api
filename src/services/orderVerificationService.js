const ApiError = require('../utils/errors');
const config = require('../config/env');
const { getVerifyServiceClient, fetchVerifyServiceDetails } = require('./twilioVerifyService');
const { normalizePhoneNumber } = require('../utils/phone');
const { createVerificationSession, getVerificationSessionById, updateVerificationSession } = require('../repositories/orderVerificationRepository');
const { createOrder, getOrderById, prepareOrderDraft } = require('./orderService');

function getExpiryDate() {
  return new Date(Date.now() + Number(config.verification.otpExpiryMinutes || 10) * 60 * 1000);
}

function getResendAvailableDate() {
  return new Date(Date.now() + Number(config.verification.otpResendCooldownSeconds || 30) * 1000);
}

function toSessionResponse(session) {
  return {
    id: session.id,
    status: session.status,
    customerName: session.customerName,
    customerPhone: session.customerPhone,
    customerEmail: session.customerEmail,
    restaurantId: session.restaurantId,
    expiresAt: session.expiresAt,
    resendAvailableAt: session.resendAvailableAt,
    attemptCount: session.attemptCount,
    resendCount: session.resendCount,
    maxAttempts: session.maxAttempts,
    orderId: session.orderId,
    orderNumber: session.orderNumber,
    verifiedAt: session.verifiedAt,
  };
}

function ensureVerificationConfig() {
  const { accountSid, authToken, verifyServiceSid, phoneNumber } = config.twilio || {};
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw ApiError.badRequest('Twilio Verify configuration is incomplete');
  }
  if (!phoneNumber) {
    console.warn('[orderVerificationService] TWILIO_PHONE_NUMBER is not set. Twilio Verify can still work without it.');
  }
}

async function createTwilioVerification(phone) {
  const verifyService = getVerifyServiceClient();
  return verifyService.verifications.create({
    to: phone,
    channel: 'sms',
  });
}

async function checkTwilioVerification(phone, code) {
  const verifyService = getVerifyServiceClient();
  return verifyService.verificationChecks.create({
    to: phone,
    code,
  });
}

async function testOrderVerificationService(payload = {}) {
  ensureVerificationConfig();
  const service = await fetchVerifyServiceDetails();
  const phone = normalizePhoneNumber(payload.phone || payload.customerPhone);
  if (!phone) {
    return {
      service,
      verification: null,
    };
  }
  const verification = await createTwilioVerification(phone);
  return {
    service,
    verification: {
      sid: verification.sid,
      status: verification.status,
      to: verification.to,
      channel: verification.channel,
    },
  };
}

async function startOrderVerification(payload = {}) {
  ensureVerificationConfig();
  const draft = await prepareOrderDraft(payload);
  const customerPhone = normalizePhoneNumber(draft.customer?.phone);
  if (!customerPhone) {
    throw ApiError.badRequest('customer.phone is required');
  }
  const session = await createVerificationSession({
    customerName: draft.customer?.name || 'Guest',
    customerPhone,
    customerEmail: draft.customer?.email || null,
    restaurantId: draft.restaurantId,
    orderPayload: {
      ...draft,
      customer: {
        ...draft.customer,
        phone: customerPhone,
      },
    },
    status: 'pending',
    attemptCount: 0,
    resendCount: 0,
    maxAttempts: Number(config.verification.otpMaxAttempts || 5),
    expiresAt: getExpiryDate(),
    resendAvailableAt: getResendAvailableDate(),
  });

  try {
    const verification = await createTwilioVerification(customerPhone);
    const updated = await updateVerificationSession(session.id, {
      twilio_verification_sid: verification.sid,
    });
    return {
      verification: toSessionResponse(updated),
    };
  } catch (error) {
    await updateVerificationSession(session.id, { status: 'failed' });
    throw error;
  }
}

async function resendOrderVerification(sessionId) {
  if (!sessionId) {
    throw ApiError.badRequest('verificationId is required');
  }
  ensureVerificationConfig();
  const session = await getVerificationSessionById(sessionId);
  if (!session) {
    throw ApiError.notFound('Verification session not found');
  }
  if (session.status === 'consumed' && session.orderId) {
    return {
      verification: toSessionResponse(session),
    };
  }
  if (session.status === 'failed') {
    throw ApiError.badRequest('Verification session has failed');
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    await updateVerificationSession(session.id, { status: 'expired' });
    throw ApiError.badRequest('Verification code has expired');
  }
  if (session.resendAvailableAt && new Date(session.resendAvailableAt).getTime() > Date.now()) {
    throw ApiError.conflict('OTP resend cooldown is still active');
  }
  if (session.attemptCount >= session.maxAttempts) {
    await updateVerificationSession(session.id, { status: 'failed' });
    throw ApiError.badRequest('Maximum OTP attempts exceeded');
  }

  try {
    const verification = await createTwilioVerification(session.customerPhone);
    const updated = await updateVerificationSession(session.id, {
      twilio_verification_sid: verification.sid,
      resend_count: session.resendCount + 1,
      resend_available_at: getResendAvailableDate(),
      expires_at: getExpiryDate(),
    });
    return {
      verification: toSessionResponse(updated),
    };
  } catch (error) {
    throw error;
  }
}

async function confirmOrderVerification(sessionId, code) {
  if (!sessionId) {
    throw ApiError.badRequest('verificationId is required');
  }
  ensureVerificationConfig();
  const session = await getVerificationSessionById(sessionId);
  if (!session) {
    throw ApiError.notFound('Verification session not found');
  }
  if (session.status === 'consumed' && session.orderId) {
    throw ApiError.conflict('Verification session has already been consumed');
  }
  if (session.status === 'processing') {
    throw ApiError.conflict('Verification is already being processed');
  }
  if (session.status === 'failed') {
    throw ApiError.badRequest('Verification session has failed');
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    await updateVerificationSession(session.id, { status: 'expired' });
    throw ApiError.badRequest('Verification code has expired');
  }
  if (session.attemptCount >= session.maxAttempts) {
    await updateVerificationSession(session.id, { status: 'failed' });
    throw ApiError.badRequest('Maximum OTP attempts exceeded');
  }
  if (!code || String(code).trim().length === 0) {
    throw ApiError.badRequest('code is required');
  }
  if (config.verification.otpLength && String(code).trim().length !== Number(config.verification.otpLength)) {
    throw ApiError.badRequest(`code must be ${config.verification.otpLength} digits`);
  }

  await updateVerificationSession(session.id, { status: 'processing' });

  let result;
  try {
    result = await checkTwilioVerification(session.customerPhone, String(code).trim());
  } catch (error) {
    await updateVerificationSession(session.id, { status: 'pending' });
    throw error;
  }
  if (String(result.status).toLowerCase() !== 'approved') {
    const nextAttempts = session.attemptCount + 1;
    const isExhausted = nextAttempts >= session.maxAttempts;
    await updateVerificationSession(session.id, {
      status: isExhausted ? 'failed' : 'pending',
      attempt_count: nextAttempts,
    });
    throw ApiError.badRequest('Invalid OTP code');
  }

  try {
    const order = await createOrder(session.orderPayload || {});
    const completed = await updateVerificationSession(session.id, {
      status: 'consumed',
      verified_at: new Date(),
      order_id: order.order?.id || order.id || null,
      order_number: order.order?.orderNumber || order.orderNumber || null,
    });

    return {
      verification: toSessionResponse(completed),
      order: order.order || order,
      automation: order.automation || null,
      notification: order.notification || null,
    };
  } catch (error) {
    await updateVerificationSession(session.id, { status: 'failed' });
    throw error;
  }
}

module.exports = {
  startOrderVerification,
  confirmOrderVerification,
  resendOrderVerification,
  testOrderVerificationService,
  toSessionResponse,
};
