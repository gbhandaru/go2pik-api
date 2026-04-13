const config = require('../config/env');
const { formatUsd } = require('../utils/currency');

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

function formatPickupTime(value) {
  if (!value) return 'Pickup time not provided';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Pickup time not provided';
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: config.notifications.timezone || 'UTC',
    });
    return formatter.format(date);
  } catch (error) {
    return 'Pickup time not provided';
  }
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

function buildOrderEmail(order) {
  const { orderNumber, restaurant = {}, customer = {} } = order;
  const pickupTime = formatPickupTime(customer.pickupTime);
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
  sendTestEmail,
};
