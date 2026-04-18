const ApiError = require('../utils/errors');
const config = require('../config/env');
const { fetchTwilioAccountDetails, sendSms } = require('./twilioSmsService');
const { normalizePhoneNumber, maskPhoneNumber } = require('../utils/phone');
const { createVerificationSession, getVerificationSessionById, updateVerificationSession } = require('../repositories/orderVerificationRepository');
const { createOrder, prepareOrderDraft } = require('./orderService');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp');

function normalizePickupType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SCHEDULED') {
    return 'SCHEDULED';
  }
  return 'ASAP';
}

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
    phone: session.phone,
    maskedPhone: session.maskedPhone,
    customerPhone: session.customerPhone,
    customerEmail: session.customerEmail,
    restaurantId: session.restaurantId,
    pickupType: session.pickupType,
    pickupTime: session.pickupTime,
    expiresAt: session.expiresAt,
    resendAvailableAt: session.resendAvailableAt,
    attemptCount: session.attemptCount,
    maxAttempts: session.maxAttempts,
    verifiedAt: session.verifiedAt,
  };
}

function ensureVerificationConfig() {
  const { accountSid, authToken, phoneNumber } = config.twilio || {};
  if (!accountSid || !authToken || !phoneNumber) {
    throw ApiError.badRequest('Twilio SMS configuration is incomplete');
  }
}

async function sendVerificationSms(phone, otp) {
  const body = `Your Go2Pik verification code is ${otp}. It expires in ${Number(config.verification.otpExpiryMinutes || 10)} minutes.`;
  console.log('[orderVerificationService] sending SMS verification', {
    phone: maskPhoneNumber(phone),
    otpLength: String(otp).length,
  });
  return sendSms({ to: phone, body });
}

async function testOrderVerificationService(payload = {}) {
  ensureVerificationConfig();
  const service = await fetchTwilioAccountDetails();
  const phone = normalizePhoneNumber(payload.phone || payload.customerPhone);
  if (!phone) {
    return {
      service,
      verification: null,
    };
  }
  const otp = generateOtp(Number(config.verification.otpLength || 6));
  const message = await sendVerificationSms(phone, otp);
  return {
    service,
    verification: {
      sid: message.sid,
      status: message.status,
      to: message.to,
      channel: 'sms',
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
  const otp = generateOtp(Number(config.verification.otpLength || 6));
  const otpHash = hashOtp(otp);
  const maskedPhone = maskPhoneNumber(customerPhone);
  const session = await createVerificationSession({
    customerName: draft.customer?.name || 'Guest',
    phone: customerPhone,
    maskedPhone,
    customerPhone,
    customerEmail: draft.customer?.email || null,
    restaurantId: draft.restaurantId,
    pickupType: normalizePickupType(draft.customer?.pickupType || draft.customer?.pickup_type),
    pickupTime: draft.customer?.pickupTime || draft.customer?.pickup_time || null,
    pendingOrderPayload: {
      ...draft,
      customer: {
        ...draft.customer,
        phone: customerPhone,
      },
    },
    otpHash,
    otpLastSentAt: new Date(),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: Number(config.verification.otpMaxAttempts || 5),
    expiresAt: getExpiryDate(),
    resendAvailableAt: getResendAvailableDate(),
  });

  try {
    const message = await sendVerificationSms(customerPhone, otp);
    console.log('[orderVerificationService] verification SMS sent', {
      sessionId: session.id,
      messageSid: message.sid,
      status: message.status,
      phone: maskedPhone,
    });
    const updated = await updateVerificationSession(session.id, {
      otp_hash: otpHash,
      otp_last_sent_at: new Date(),
    });
    return {
      verification: toSessionResponse(updated),
    };
  } catch (error) {
    console.error('[orderVerificationService] failed to send verification SMS', {
      sessionId: session.id,
      phone: maskedPhone,
      code: error?.code,
      status: error?.status,
      message: error?.message,
    });
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
  if (session.status === 'consumed') {
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
    const otp = generateOtp(Number(config.verification.otpLength || 6));
    const otpHash = hashOtp(otp);
    const message = await sendVerificationSms(session.customerPhone, otp);
    console.log('[orderVerificationService] verification SMS resent', {
      sessionId: session.id,
      messageSid: message.sid,
      status: message.status,
      phone: maskPhoneNumber(session.customerPhone),
    });
    const updated = await updateVerificationSession(session.id, {
      otp_hash: otpHash,
      otp_last_sent_at: new Date(),
      resend_available_at: getResendAvailableDate(),
      expires_at: getExpiryDate(),
    });
    return {
      verification: toSessionResponse(updated),
    };
  } catch (error) {
    console.error('[orderVerificationService] failed to resend verification SMS', {
      sessionId: session.id,
      phone: maskPhoneNumber(session.customerPhone),
      code: error?.code,
      status: error?.status,
      message: error?.message,
    });
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
  if (session.status === 'consumed') {
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
  const isValid = verifyOtp(String(code).trim(), session.otpHash);
  if (!isValid) {
    console.warn('[orderVerificationService] verification code rejected', {
      sessionId: session.id,
      phone: maskPhoneNumber(session.customerPhone),
      attemptCount: session.attemptCount + 1,
      maxAttempts: session.maxAttempts,
    });
    const nextAttempts = session.attemptCount + 1;
    const isExhausted = nextAttempts >= session.maxAttempts;
    await updateVerificationSession(session.id, {
      status: isExhausted ? 'failed' : 'pending',
      attempt_count: nextAttempts,
    });
    throw ApiError.badRequest('Invalid OTP code');
  }

  try {
    console.log('[orderVerificationService] OTP approved, creating final order', {
      sessionId: session.id,
      phone: maskPhoneNumber(session.customerPhone),
      restaurantId: session.restaurantId,
    });
    const order = await createOrder(session.pendingOrderPayload || {});
    const completed = await updateVerificationSession(session.id, {
      status: 'consumed',
      verified_at: new Date(),
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
