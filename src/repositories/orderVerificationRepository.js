const pool = require('../config/db');

function mapVerification(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    restaurantId: row.restaurant_id,
    orderPayload: row.order_payload,
    twilioVerificationSid: row.twilio_verification_sid,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    resendCount: Number(row.resend_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    expiresAt: row.expires_at,
    resendAvailableAt: row.resend_available_at,
    verifiedAt: row.verified_at,
    orderId: row.order_id,
    orderNumber: row.order_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createVerificationSession(fields) {
  const query = `
    INSERT INTO order_verifications (
      customer_name,
      customer_phone,
      customer_email,
      restaurant_id,
      order_payload,
      twilio_verification_sid,
      status,
      attempt_count,
      resend_count,
      max_attempts,
      expires_at,
      resend_available_at,
      verified_at,
      order_id,
      order_number
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *;
  `;
  const values = [
    fields.customerName || 'Guest',
    fields.customerPhone,
    fields.customerEmail || null,
    fields.restaurantId,
    JSON.stringify(fields.orderPayload || {}),
    fields.twilioVerificationSid || null,
    fields.status || 'pending',
    fields.attemptCount || 0,
    fields.resendCount || 0,
    fields.maxAttempts || 0,
    fields.expiresAt,
    fields.resendAvailableAt,
    fields.verifiedAt || null,
    fields.orderId || null,
    fields.orderNumber || null,
  ];
  const { rows } = await pool.query(query, values);
  return mapVerification(rows[0]);
}

async function getVerificationSessionById(id) {
  const query = `
    SELECT *
    FROM order_verifications
    WHERE id = $1
    LIMIT 1;
  `;
  const { rows } = await pool.query(query, [id]);
  return mapVerification(rows[0]);
}

async function updateVerificationSession(id, fields = {}) {
  const updates = [];
  const values = [];
  const normalized = {
    ...fields,
  };
  if (normalized.orderPayload !== undefined) {
    normalized.order_payload = JSON.stringify(normalized.orderPayload || {});
    delete normalized.orderPayload;
  }
  Object.entries(normalized).forEach(([key, value]) => {
    if (value !== undefined) {
      values.push(value);
      updates.push(`${key} = $${values.length}`);
    }
  });
  if (updates.length === 0) {
    return getVerificationSessionById(id);
  }
  values.push(id);
  const query = `
    UPDATE order_verifications
    SET ${updates.join(', ')}, updated_at = now()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return mapVerification(rows[0]);
}

module.exports = {
  createVerificationSession,
  getVerificationSessionById,
  updateVerificationSession,
  mapVerification,
};
