const config = require('../config/env');
const { formatUsd } = require('../utils/currency');
const { normalizePhoneNumber, isE164PhoneNumber } = require('../utils/phone');
const { sendSms } = require('./twilioSmsService');
const { issueOrderReviewToken } = require('../utils/token');

function isEmailConfigured() {
  const { notifications } = config;
  if (!notifications || notifications.enabled === false) {
    return false;
  }
  if (notifications.provider === 'sendgrid') {
    return Boolean(notifications.sendgrid?.apiKey);
  }
  return Boolean(notifications.providerUrl && notifications.apiKey);
}

function pickTrimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolvePickupTimeLabel(order = {}) {
  const customer = order.customer || {};
  const pickupRequest = order.pickupRequest || {};
  const summary = pickTrimmedString(pickupRequest.summary);
  const customerDisplayTime = pickTrimmedString(customer.pickupDisplayTime);
  const requestDisplayTime = pickTrimmedString(pickupRequest.displayTime);
  const pickupTime = pickTrimmedString(customer.pickupTime);

  return summary || customerDisplayTime || requestDisplayTime || pickupTime || 'Pickup time not provided';
}

function renderItems(items = []) {
  if (!items.length) {
    return 'No items listed';
  }
  return items
    .map((item) => {
      const quantity = item.quantity ?? 1;
      const name = item.name || 'Item';
      const price = item.priceDisplay || formatUsd(item.price || 0);
      const lineTotal = item.lineTotalDisplay || formatUsd(item.lineTotal || 0);
      return `${quantity} x ${name} @ ${price} = ${lineTotal}`;
    })
    .join('\n');
}

function isSmsConfigured() {
  const { twilio } = config;
  return Boolean(twilio?.accountSid && twilio?.authToken && twilio?.phoneNumber);
}

function buildOrderReviewLink(order, token) {
  const baseUrl = String(config.publicLinks?.orderReviewBaseUrl || 'https://go2pik.com/order').replace(/\/+$/, '');
  return `${baseUrl}/${encodeURIComponent(order.orderNumber)}?token=${encodeURIComponent(token)}`;
}

function formatPartialAcceptanceSummary(order) {
  const unavailableCount = Array.isArray(order.unavailableItems) ? order.unavailableItems.length : 0;
  if (unavailableCount === 1) {
    return '1 item unavailable.';
  }
  return `${unavailableCount} items unavailable.`;
}

function buildPartialAcceptanceSms(order, token) {
  const restaurantName = order.restaurant?.name || 'Go2Pik';
  const link = buildOrderReviewLink(order, token);
  return [
    `Go2Pik: ${restaurantName} updated your order.`,
    formatPartialAcceptanceSummary(order),
    '',
    'Review & confirm your order:',
    link,
  ].join('\n');
}

async function sendPartialAcceptanceSms(order) {
  const rawPhone = order?.customer?.phone || '';
  const normalizedPhone = normalizePhoneNumber(rawPhone);
  if (!normalizedPhone) {
    console.warn('[notification] skipping partial acceptance SMS: missing customer phone', {
      orderNumber: order?.orderNumber || null,
      customerPhonePresent: Boolean(rawPhone),
    });
    return { delivered: false, skipped: true, reason: 'missing_customer_phone' };
  }
  if (!isE164PhoneNumber(normalizedPhone)) {
    console.warn('[notification] skipping partial acceptance SMS: invalid phone format', {
      orderNumber: order?.orderNumber || null,
      phone: normalizedPhone,
    });
    return {
      delivered: false,
      skipped: true,
      reason: 'invalid_customer_phone_format',
      phone: normalizedPhone,
    };
  }
  if (!isSmsConfigured()) {
    console.warn('[notification] skipping partial acceptance SMS: Twilio not configured', {
      orderNumber: order?.orderNumber || null,
    });
    return { delivered: false, skipped: true, reason: 'not_configured' };
  }
  const token = issueOrderReviewToken(order);
  const body = buildPartialAcceptanceSms(order, token);
  const result = await sendSms({
    to: normalizedPhone,
    body,
  });
  console.log('[notification] partial acceptance SMS delivered', {
    orderNumber: order?.orderNumber || null,
    to: normalizedPhone,
    messageSid: result?.sid || null,
  });
  return {
    delivered: true,
    skipped: false,
    token,
    messageSid: result?.sid || null,
    body,
  };
}

function buildOrderEmail(order) {
  const { orderNumber, restaurant = {}, customer = {} } = order;
  const pickupTime = resolvePickupTimeLabel(order);
  const totalAmount = order.totalDisplay || formatUsd(order.total || 0);
  const itemsText = renderItems(order.items || []);
  const subject = `Order ${orderNumber} confirmed at ${restaurant.name || 'Go2Pik'}`;
  const textBody = `Hi ${customer.name || 'there'},\n\n`
    + `Your order ${orderNumber} at ${restaurant.name || 'the restaurant'} is confirmed.\n\n`
    + `Pickup time: ${pickupTime}\n`
    + `Items:\n${itemsText}\n\n`
    + `Total amount: ${totalAmount}\n\n`
    + 'Thank you for ordering with Go2Pik!\n';
  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #111;">
      <p>Hi ${customer.name || 'there'},</p>
      <p>Your order <strong>${orderNumber}</strong> at <strong>${restaurant.name || 'the restaurant'}</strong> is confirmed.</p>
      <p><strong>Pickup time:</strong> ${pickupTime}</p>
      <p><strong>Items:</strong></p>
      <pre style="background:#f6f8fa; padding:12px; border-radius:6px;">${itemsText}</pre>
      <p><strong>Total amount:</strong> ${totalAmount}</p>
      <p>Thank you for ordering with Go2Pik!</p>
    </div>
  `;
  return { subject, textBody, htmlBody };
}

function buildWelcomeEmail(customer = {}) {
  const name = customer.name || customer.full_name || 'there';
  const subject = 'Welcome to Go2Pik!';
  const textBody = `Hi ${name},\n\n`
    + 'Thanks for signing up with us! Your profile has been successfully created.\n\n'
    + 'You can now log in anytime to access your account, update your details, and explore our services.\n\n'
    + 'If you have any questions or need help getting started, feel free to reach out—we’re here to help.\n\n'
    + 'Welcome aboard!\n\nBest regards,\nGo2Pik';
  const htmlBody = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #111;">
      <p>Hi ${name},</p>
      <p>Thanks for signing up with us! Your profile has been successfully created.</p>
      <p>You can now log in anytime to access your account, update your details, and explore our services.</p>
      <p>If you have any questions or need help getting started, feel free to reach out—we’re here to help.</p>
      <p>Welcome aboard!</p>
      <p>Best regards,<br/>Go2Pik</p>
    </div>
  `;
  return { subject, textBody, htmlBody };
}

async function deliverViaCustomProvider({ to, subject, text, html, metadata }) {
  const {
    providerUrl,
    apiKey,
    fromEmail,
    fromName,
    timeoutMs = 8000,
  } = config.notifications;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: to.email, name: to.name }],
        subject,
        text,
        html,
        metadata,
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`Email provider responded with ${response.status}`);
      error.responseBody = bodyText;
      throw error;
    }
    return { ok: true, response: bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverViaSendgrid({ to, subject, text, html, metadata }) {
  const {
    timeoutMs = 8000,
    sendgrid,
    fromEmail,
    fromName,
  } = config.notifications;
  const apiKey = sendgrid?.apiKey;
  if (!apiKey) {
    throw new Error('SendGrid API key missing');
  }
  console.log('[notification] deliverViaSendgrid starting', {
    to: to?.email,
    subject,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to.email, name: to.name }],
            custom_args: metadata || {},
          },
        ],
        from: { email: fromEmail, name: fromName },
        reply_to: { email: fromEmail, name: fromName },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const error = new Error(`SendGrid responded with ${response.status}`);
      error.responseBody = bodyText;
      error.statusCode = response.status;
      throw error;
    }
    console.log('[notification] deliverViaSendgrid completed', {
      to: to?.email,
      status: response.status,
    });
    return { ok: true, response: bodyText, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverEmail(options) {
  console.log('[notification] deliverEmail invoked', {
    provider: config.notifications.provider,
    to: options?.to?.email,
    subject: options?.subject,
  });
  if (config.notifications.provider === 'sendgrid') {
    return deliverViaSendgrid(options);
  }
  return deliverViaCustomProvider(options);
}

async function sendTestEmail(toEmail) {
  console.log('[notification] sendTestEmail invoked', {
    toEmail,
    provider: config.notifications.provider,
  });
  if (!toEmail) {
    const error = new Error('Query parameter "to" is required');
    error.status = 400;
    throw error;
  }
  if (config.notifications.provider !== 'sendgrid') {
    const error = new Error('SendGrid provider is not enabled');
    error.status = 400;
    throw error;
  }
  if (!isEmailConfigured()) {
    const error = new Error('Email notifications are not configured');
    error.status = 400;
    throw error;
  }
  const timestamp = new Date().toISOString();
  const payload = {
    to: { email: toEmail, name: 'Go2Pik Tester' },
    subject: `Go2Pik SendGrid test @ ${timestamp}`,
    text: `SendGrid connectivity test fired at ${timestamp}.`,
    html: `<p>SendGrid connectivity test fired at <strong>${timestamp}</strong>.</p>`,
    metadata: {
      template: 'sendgrid_test',
      triggeredBy: 'GET /test-email',
      timestamp,
    },
  };
  const result = await deliverViaSendgrid(payload);
  console.log('[notification] sendTestEmail completed', {
    toEmail,
    status: result.status,
  });
  return { provider: 'sendgrid', status: result.status, response: result.response };
}

async function sendWelcomeEmail(customer = {}) {
  console.log('[notification] sendWelcomeEmail called', {
    customerId: customer?.id,
    email: customer?.email,
  });
  if (!customer || !customer.email) {
    console.log('[notification] skipping welcome email: missing customer email', {
      customerId: customer?.id,
    });
    return { delivered: false, reason: 'missing_customer_email' };
  }
  if (!isEmailConfigured()) {
    console.log('[notification] skipping welcome email: provider not configured');
    return { delivered: false, reason: 'not_configured' };
  }
  const { subject, textBody, htmlBody } = buildWelcomeEmail(customer);
  try {
    const result = await deliverEmail({
      to: { email: customer.email, name: customer.name || customer.full_name || 'Customer' },
      subject,
      text: textBody,
      html: htmlBody,
      metadata: {
        template: 'welcome_email',
        customerId: customer.id,
      },
    });
    console.log('[notification] welcome email delivered', {
      customerId: customer.id,
      email: customer.email,
      status: result.status || 'ok',
    });
    return { delivered: true };
  } catch (error) {
    console.error('[notification] welcome email failed', {
      customerId: customer.id,
      email: customer.email,
      error: error.message,
    });
    return { delivered: false, reason: 'provider_error', error: error.message };
  }
}

async function sendOrderConfirmationEmail(order) {
  console.log('[notification] sendOrderConfirmationEmail called', {
    orderNumber: order?.orderNumber,
    customerEmail: order?.customer?.email,
  });
  if (!order || !order.customer || !order.customer.email) {
    console.log('[notification] skipping email delivery: missing customer email', {
      orderNumber: order?.orderNumber,
    });
    return { delivered: false, reason: 'missing_customer_email' };
  }
  if (!isEmailConfigured()) {
    console.log('[notification] skipping email delivery: provider not configured', {
      provider: config.notifications.provider,
    });
    return { delivered: false, reason: 'not_configured' };
  }
  const { subject, textBody, htmlBody } = buildOrderEmail(order);
  try {
    const result = await deliverEmail({
      to: { email: order.customer.email, name: order.customer.name || 'Customer' },
      subject,
      text: textBody,
      html: htmlBody,
      metadata: {
        template: 'order_confirmation',
        orderNumber: order.orderNumber,
        restaurantId: order.restaurant?.id,
      },
    });
    console.log('[notification] order email delivered', {
      orderNumber: order.orderNumber,
      customerEmail: order.customer.email,
      provider: config.notifications.provider,
      status: result.status || 'ok',
    });
    return { delivered: true };
  } catch (error) {
    console.error('[notification] email send failed', {
      orderNumber: order.orderNumber,
      customerEmail: order.customer.email,
      provider: config.notifications.provider,
      error: error.message,
      responseBody: error.responseBody,
      statusCode: error.statusCode,
    });
    return { delivered: false, reason: 'provider_error', error: error.message };
  }
}

module.exports = {
  sendOrderConfirmationEmail,
  isEmailConfigured,
  isSmsConfigured,
  buildOrderReviewLink,
  buildPartialAcceptanceSms,
  sendPartialAcceptanceSms,
  sendWelcomeEmail,
  sendTestEmail,
};
