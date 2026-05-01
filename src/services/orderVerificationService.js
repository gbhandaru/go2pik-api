const ApiError = require('../utils/errors');
const config = require('../config/env');
const { getTwilioClient } = require('./twilioSmsService');
const { normalizePhoneNumber, maskPhoneNumber } = require('../utils/phone');
const {
  createVerificationSession,
  getVerificationSessionById,
  claimVerificationSessionForProcessing,
  updateVerificationSession,
} = require('../repositories/orderVerificationRepository');
const { withTimeout } = require('../utils/timeout');
const {
  createOrder,
  getOrderById,
  getOrderByNumber,
  prepareOrderDraft,
} = require('./orderService');

function getExpiryDate() {
  return new Date(Date.now() + Number(config.verification.otpExpiryMinutes || 10) * 60 * 1000);
}

function getResendAvailableDate() {
  return new Date(Date.now() + Number(config.verification.otpResendCooldownSeconds || 30) * 1000);
}

function getTwilioVerifyTimeoutMs() {
  return Number(config.twilio?.requestTimeoutMs || 8000);
}

function normalizeSmsConsent(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
  }
  return false;
}

function buildConsentDetails(payload = {}) {
  const smsConsent = normalizeSmsConsent(
    payload.smsConsent ??
      payload.smsConsentAccepted ??
      payload.sms_consent ??
      payload.customer?.smsConsent ??
      payload.customer?.smsConsentAccepted ??
      payload.customer?.sms_consent ??
      false
  );
  return {
    smsConsent,
    smsConsentAt: smsConsent ? new Date().toISOString() : null,
    smsConsentText: smsConsent
      ? payload.smsConsentText ||
        payload.customer?.smsConsentText ||
        payload.customer?.sms_consent_text ||
        null
      : null,
    smsConsentVersion: smsConsent
      ? payload.smsConsentVersion ||
        payload.customer?.smsConsentVersion ||
        payload.customer?.sms_consent_version ||
        null
      : null,
    smsOptInSource: smsConsent
      ? payload.smsOptInSource ||
        payload.smsConsentSource ||
        payload.customer?.smsOptInSource ||
        payload.customer?.sms_consent_source ||
        null
      : null,
  };
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

async function resolveOrderForVerificationSession(session) {
  if (!session) {
    return null;
  }
  if (session.orderId) {
    try {
      return await getOrderById(session.orderId);
    } catch (error) {
      if (!error || error.status !== 404) {
        throw error;
      }
    }
  }
  if (session.orderNumber) {
    try {
      return await getOrderByNumber(session.orderNumber);
    } catch (error) {
      if (!error || error.status !== 404) {
        throw error;
      }
    }
  }
  return null;
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

function isRetryableTwilioError(error) {
  return Boolean(error?.retryable || error?.code === 'ETIMEDOUT');
}

async function fetchVerifyServiceWithTimeout() {
  return withTimeout(
    () => getVerifyService().fetch(),
    getTwilioVerifyTimeoutMs(),
    'Twilio Verify service lookup timed out'
  );
}

async function sendVerificationWithTimeout(phone) {
  return withTimeout(
    () => getVerifyService().verifications.create({
      to: phone,
      channel: 'sms',
    }),
    getTwilioVerifyTimeoutMs(),
    'Twilio Verify send timed out'
  );
}

async function checkVerificationWithTimeout(phone, code) {
  return withTimeout(
    () => getVerifyService().verificationChecks.create({
      to: phone,
      code: String(code).trim(),
    }),
    getTwilioVerifyTimeoutMs(),
    'Twilio Verify check timed out'
  );
}

async function testOrderVerificationService(payload = {}) {
  const service = await fetchVerifyServiceWithTimeout();
  const phone = normalizePhoneNumber(payload.phone || payload.customerPhone);
  if (!phone) {
    return {
      service,
      verification: null,
    };
  }
  const verification = await sendVerificationWithTimeout(phone);
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
  const draft = await prepareOrderDraft(payload);
  const consent = buildConsentDetails(payload);
  draft.customer = {
    ...(draft.customer || {}),
    ...consent,
  };
  if (!consent.smsConsent) {
    console.log('[orderVerificationService] smsConsent=false, creating order without OTP', {
      restaurantId: draft.restaurantId,
      customerPhonePresent: Boolean(draft.customer?.phone),
      itemCount: Array.isArray(draft.items) ? draft.items.length : 0,
    });
    const order = await createOrder({
      ...payload,
      smsConsent: false,
      smsConsentAt: consent.smsConsentAt,
      smsConsentText: consent.smsConsentText,
      smsConsentVersion: consent.smsConsentVersion,
      smsOptInSource: consent.smsOptInSource,
      customer: {
        ...(payload.customer || {}),
        ...(draft.customer || {}),
        ...consent,
      },
    });
    return {
      verification: null,
      order: order.order || order,
      automation: order.automation || null,
      notification: order.notification || null,
      smsNotification: order.smsNotification || null,
      notifications: order.notifications || null,
    };
  }
  ensureVerificationConfig();
  const customerPhone = normalizePhoneNumber(draft.customer?.phone);
  const maskedPhone = maskPhoneNumber(customerPhone);
  console.log('[orderVerificationService] start verification draft prepared', {
    restaurantId: draft.restaurantId,
    customerPhone: maskedPhone,
    customerEmailPresent: Boolean(draft.customer?.email),
    itemCount: Array.isArray(draft.items) ? draft.items.length : 0,
    pickupType: draft.pickupType,
    pickupTimePresent: Boolean(draft.pickupTime),
  });
  const session = await createVerificationSession({
    customerName: draft.customer?.name || 'Guest',
    phone: customerPhone,
    maskedPhone,
    customerPhone,
    customerEmail: draft.customer?.email || null,
    restaurantId: draft.restaurantId,
    pickupType: draft.pickupType,
    pickupTime: draft.pickupTime || null,
    smsConsent: consent.smsConsent,
    smsConsentAt: consent.smsConsentAt,
    smsConsentText: consent.smsConsentText,
    smsConsentVersion: consent.smsConsentVersion,
    smsOptInSource: consent.smsOptInSource,
    pendingOrderPayload: {
      ...draft,
      customer: {
        ...draft.customer,
        phone: customerPhone,
        ...consent,
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
    const verification = await sendVerificationWithTimeout(customerPhone);
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
    if (isRetryableTwilioError(error)) {
      await updateVerificationSession(session.id, { status: 'pending' });
      throw error;
    }
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
    const verification = await sendVerificationWithTimeout(session.customerPhone);
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
  const completedOrder = await resolveOrderForVerificationSession(session);
  if (completedOrder && (session.status === 'consumed' || session.status === 'processing')) {
    return {
      verification: toSessionResponse(session),
      order: completedOrder,
      automation: null,
      notification: null,
      smsNotification: null,
      notifications: null,
    };
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

  const claimedSession = await claimVerificationSessionForProcessing(session.id);
  if (!claimedSession) {
    const refreshed = await getVerificationSessionById(session.id);
    const existingOrder = await resolveOrderForVerificationSession(refreshed);
    if (existingOrder && (refreshed?.status === 'consumed' || refreshed?.status === 'processing')) {
      return {
        verification: toSessionResponse(refreshed),
        order: existingOrder,
        automation: null,
        notification: null,
        smsNotification: null,
        notifications: null,
      };
    }
    if (refreshed?.status === 'processing') {
      throw ApiError.conflict('Verification is already being processed');
    }
    if (refreshed?.status === 'consumed') {
      throw ApiError.conflict('Verification session has already been consumed');
    }
    if (refreshed?.status === 'failed') {
      throw ApiError.badRequest('Verification session has failed');
    }
    throw ApiError.conflict('Verification session could not be claimed');
  }

  try {
    const check = await checkVerificationWithTimeout(session.customerPhone, code);
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
      const otpError = ApiError.badRequest('Invalid OTP code');
      otpError._otpFailure = true;
      throw otpError;
    }
  } catch (error) {
    if (error?._otpFailure) {
      throw error;
    }
    if (isRetryableTwilioError(error)) {
      console.warn('[orderVerificationService] Twilio Verify check timed out or was retryable', {
        sessionId: session.id,
        phone: maskPhoneNumber(session.customerPhone),
        code: error?.code,
        status: error?.status,
        message: error?.message,
      });
      await updateVerificationSession(session.id, { status: 'pending' });
      throw error;
    }
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

  console.log('[orderVerificationService] OTP approved, creating final order', {
    sessionId: session.id,
    phone: maskPhoneNumber(session.customerPhone),
    restaurantId: session.restaurantId,
  });

  let order;
  try {
    order = await createOrder(session.pendingOrderPayload || {});
  } catch (error) {
    await updateVerificationSession(session.id, { status: 'pending' });
    throw error;
  }

  const createdOrder = order.order || order;
  try {
    const completed = await updateVerificationSession(session.id, {
      status: 'consumed',
      verified_at: new Date(),
      order_id: createdOrder.id,
      order_number: createdOrder.orderNumber,
    });

    return {
      verification: toSessionResponse(completed),
      order: createdOrder,
      automation: order.automation || null,
      notification: order.notification || null,
      smsNotification: order.smsNotification || null,
      notifications: order.notifications || null,
    };
  } catch (error) {
    try {
      const failed = await updateVerificationSession(session.id, {
        status: 'failed',
        verified_at: new Date(),
        order_id: createdOrder.id,
        order_number: createdOrder.orderNumber,
      });
      console.warn('[orderVerificationService] final verification update failed after order creation', {
        sessionId: session.id,
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
        sessionStatus: failed?.status || 'failed',
      });
    } catch (recoveryError) {
      console.error('[orderVerificationService] failed to persist order reference after confirmation', {
        sessionId: session.id,
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
        code: recoveryError?.code,
        message: recoveryError?.message,
      });
    }
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
