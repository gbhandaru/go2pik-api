const pool = require('../config/db');

function mapVerification(row) {
  if (!row) return null;
  return {
    id: row.verification_id ?? row.id,
    customerName: row.customer_name,
    phone: row.phone,
    maskedPhone: row.masked_phone,
    customerPhone: row.customer_phone || row.phone,
    customerEmail: row.customer_email,
    restaurantId: row.restaurant_id,
    pickupType: row.pickup_type,
    pickupTime: row.pickup_time,
    pendingOrderPayload: row.pending_order_payload,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    expiresAt: row.expires_at,
    resendAvailableAt: row.resend_available_at,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePickupType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SCHEDULED') {
    return 'SCHEDULED';
  }
  return 'ASAP';
}

async function createVerificationSession(fields) {
  const query = `
    INSERT INTO order_verifications (
      customer_name,
      phone,
      masked_phone,
      customer_phone,
      customer_email,
      restaurant_id,
      pickup_type,
      pickup_time,
      pending_order_payload,
      status,
      attempt_count,
      max_attempts,
      expires_at,
      resend_available_at,
      verified_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *;
  `;
  const values = [
    fields.customerName || 'Guest',
    fields.phone,
    fields.maskedPhone || null,
    fields.customerPhone || fields.phone || null,
    fields.customerEmail || null,
    fields.restaurantId,
    normalizePickupType(fields.pickupType),
    fields.pickupTime || null,
    JSON.stringify(fields.pendingOrderPayload || {}),
    fields.status || 'pending',
    fields.attemptCount || 0,
    fields.maxAttempts || 0,
    fields.expiresAt,
    fields.resendAvailableAt,
    fields.verifiedAt || null,
  ];
  const { rows } = await pool.query(query, values);
  return mapVerification(rows[0]);
}

async function getVerificationSessionById(id) {
  const query = `
    SELECT *
    FROM order_verifications
    WHERE verification_id = $1
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
  if (normalized.pendingOrderPayload !== undefined) {
    normalized.pending_order_payload = JSON.stringify(normalized.pendingOrderPayload || {});
    delete normalized.pendingOrderPayload;
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
    WHERE verification_id = $${values.length}
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
