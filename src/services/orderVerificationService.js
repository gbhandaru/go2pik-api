const ApiError = require('../utils/errors');
const config = require('../config/env');
const { getTwilioClient } = require('./twilioSmsService');
const { normalizePhoneNumber, maskPhoneNumber } = require('../utils/phone');
const { createVerificationSession, getVerificationSessionById, updateVerificationSession } = require('../repositories/orderVerificationRepository');
const { createOrder, prepareOrderDraft } = require('./orderService');

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
    twilioVerificationSid: session.twilioVerificationSid || null,
  };
}

function ensureVerificationConfig() {
  const { accountSid, authToken, verifyServiceSid } = config.twilio || {};
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw ApiError.badRequest('Twilio Verify configuration is incomplete');
  }
}

function getVerifyService() {
  ensureVerificationConfig();
  const client = getTwilioClient();
  return client.verify.v2.services(config.twilio.verifyServiceSid);
}

async function testOrderVerificationService(payload = {}) {
  const service = await getVerifyService().fetch();
  const phone = normalizePhoneNumber(payload.phone || payload.customerPhone);
  if (!phone) {
    return {
      service,
      verification: null,
    };
  }
  const verification = await getVerifyService().verifications.create({
    to: phone,
    channel: 'sms',
  });
  console.log('[orderVerificationService] Twilio Verify test send status', {
    serviceSid: service.sid || null,
    verificationSid: verification.sid || null,
    status: verification.status || null,
    phone: maskPhoneNumber(phone),
  });
  return {
    service,
    verification: {
      sid: verification.sid,
      status: verification.status,
      to: verification.to,
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
  const maskedPhone = maskPhoneNumber(customerPhone);
  console.log('[orderVerificationService] start verification draft prepared', {
    restaurantId: draft.restaurantId,
    customerPhone: maskedPhone,
    customerEmailPresent: Boolean(draft.customer?.email),
    itemCount: Array.isArray(draft.items) ? draft.items.length : 0,
    pickupType: normalizePickupType(draft.customer?.pickupType || draft.customer?.pickup_type),
    pickupTimePresent: Boolean(draft.customer?.pickupTime || draft.customer?.pickup_time),
  });
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
    status: 'pending',
    attemptCount: 0,
    maxAttempts: Number(config.verification.otpMaxAttempts || 5),
    expiresAt: getExpiryDate(),
    resendAvailableAt: getResendAvailableDate(),
  });
  console.log('[orderVerificationService] verification session created', {
    sessionId: session.id,
    status: session.status,
    phone: session.maskedPhone || maskedPhone,
    pickupType: session.pickupType,
    pickupTime: session.pickupTime,
    expiresAt: session.expiresAt,
    resendAvailableAt: session.resendAvailableAt,
  });

  try {
    const verification = await getVerifyService().verifications.create({
      to: customerPhone,
      channel: 'sms',
    });
    console.log('[orderVerificationService] Twilio Verify send status', {
      sessionId: session.id,
      verificationSid: verification.sid,
      status: verification.status,
      to: verification.to,
      phone: maskedPhone,
    });
    const updated = await updateVerificationSession(session.id, {
      twilio_verification_sid: verification.sid,
    });
    console.log('[orderVerificationService] verification session updated after Twilio Verify send', {
      sessionId: updated.id,
      status: updated.status,
      twilioVerificationSid: verification.sid,
    });
    return {
      verification: {
        ...toSessionResponse(updated),
        twilioVerificationSid: verification.sid,
      },
      twilioVerification: {
        sid: verification.sid,
        status: verification.status,
        to: verification.to,
        channel: verification.channel,
      },
    };
  } catch (error) {
    console.error('[orderVerificationService] failed to send Twilio Verify verification', {
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
    const verification = await getVerifyService().verifications.create({
      to: session.customerPhone,
      channel: 'sms',
    });
    console.log('[orderVerificationService] Twilio Verify resend status', {
      sessionId: session.id,
      verificationSid: verification.sid,
      status: verification.status,
      phone: maskPhoneNumber(session.customerPhone),
    });
    const updated = await updateVerificationSession(session.id, {
      twilio_verification_sid: verification.sid,
      resend_available_at: getResendAvailableDate(),
      expires_at: getExpiryDate(),
    });
    return {
      verification: {
        ...toSessionResponse(updated),
        twilioVerificationSid: verification.sid,
      },
      twilioVerification: {
        sid: verification.sid,
        status: verification.status,
        to: verification.to,
        channel: verification.channel,
      },
    };
  } catch (error) {
    console.error('[orderVerificationService] failed to resend Twilio Verify verification', {
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

  await updateVerificationSession(session.id, { status: 'processing' });

  try {
    const check = await getVerifyService().verificationChecks.create({
      to: session.customerPhone,
      code: String(code).trim(),
    });
    console.log('[orderVerificationService] Twilio Verify check status', {
      sessionId: session.id,
      verificationSid: check.sid || null,
      status: check.status || null,
      phone: maskPhoneNumber(session.customerPhone),
    });
    if (check.status !== 'approved') {
      const nextAttempts = session.attemptCount + 1;
      const isExhausted = nextAttempts >= session.maxAttempts;
      console.warn('[orderVerificationService] Twilio Verify code rejected', {
        sessionId: session.id,
        phone: maskPhoneNumber(session.customerPhone),
        attemptCount: nextAttempts,
        maxAttempts: session.maxAttempts,
        twilioStatus: check.status || null,
      });
      await updateVerificationSession(session.id, {
        status: isExhausted ? 'failed' : 'pending',
        attempt_count: nextAttempts,
      });
      throw ApiError.badRequest('Invalid OTP code');
    }
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
    if (error?.status && error.status < 500) {
      console.warn('[orderVerificationService] Twilio Verify check failed', {
        sessionId: session.id,
        phone: maskPhoneNumber(session.customerPhone),
        code: error?.code,
        status: error?.status,
        message: error?.message,
      });
      const nextAttempts = session.attemptCount + 1;
      const isExhausted = nextAttempts >= session.maxAttempts;
      await updateVerificationSession(session.id, {
        status: isExhausted ? 'failed' : 'pending',
        attempt_count: nextAttempts,
      });
      throw ApiError.badRequest('Invalid OTP code');
    }
    if (error instanceof ApiError) {
      throw error;
    }
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
