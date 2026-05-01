const pool = require('../config/db');
const ApiError = require('../utils/errors');

function assertInsertArity(context, targetColumns, valueExpressions) {
  if (targetColumns.length !== valueExpressions.length) {
    throw ApiError.badRequest(
      `${context} insert configuration is invalid: expected ${targetColumns.length} values, received ${valueExpressions.length}`
    );
  }
}

let payloadColumnInfoPromise = null;

async function getOrderVerificationPayloadColumnInfo() {
  if (!payloadColumnInfoPromise) {
    payloadColumnInfoPromise = pool
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'order_verifications'
            AND column_name IN ('order_payload', 'pending_order_payload');
        `
      )
      .then(({ rows }) => {
        const columns = new Set(rows.map((row) => row.column_name));
        return {
          hasOrderPayload: columns.has('order_payload'),
          hasPendingOrderPayload: columns.has('pending_order_payload'),
        };
      })
      .catch((error) => {
        payloadColumnInfoPromise = null;
        throw error;
      });
  }
  return payloadColumnInfoPromise;
}

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
    pendingOrderPayload: row.order_payload ?? row.pending_order_payload,
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    expiresAt: row.expires_at,
    resendAvailableAt: row.resend_available_at,
    verifiedAt: row.verified_at,
    orderId: row.order_id === null || row.order_id === undefined ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
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
  const payloadColumns = await getOrderVerificationPayloadColumnInfo();
  const targetColumns = [];
  const values = [];
  const pushColumn = (column, value) => {
    targetColumns.push(column);
    values.push(value);
  };
  const payloadValue = JSON.stringify(fields.pendingOrderPayload || {});

  pushColumn('customer_name', fields.customerName || 'Guest');
  pushColumn('phone', fields.phone);
  pushColumn('masked_phone', fields.maskedPhone || null);
  pushColumn('customer_phone', fields.customerPhone || fields.phone || null);
  pushColumn('customer_email', fields.customerEmail || null);
  pushColumn('restaurant_id', fields.restaurantId);
  pushColumn('pickup_type', normalizePickupType(fields.pickupType));
  pushColumn('pickup_time', fields.pickupTime || null);
  if (payloadColumns.hasOrderPayload) {
    pushColumn('order_payload', payloadValue);
  }
  if (payloadColumns.hasPendingOrderPayload) {
    pushColumn('pending_order_payload', payloadValue);
  }
  pushColumn('status', fields.status || 'pending');
  pushColumn('attempt_count', fields.attemptCount || 0);
  pushColumn('max_attempts', fields.maxAttempts || 0);
  pushColumn('expires_at', fields.expiresAt);
  pushColumn('resend_available_at', fields.resendAvailableAt);
  pushColumn('verified_at', fields.verifiedAt || null);
  const query = `
    INSERT INTO order_verifications (
      ${targetColumns.join(', ')}
    )
    VALUES (${targetColumns.map((_, index) => `$${index + 1}`).join(', ')})
    RETURNING *;
  `;
  assertInsertArity('Order verification session', targetColumns, values);
  try {
    const { rows } = await pool.query(query, values);
    return mapVerification(rows[0]);
  } catch (error) {
    if (
      error?.code === '42601' &&
      typeof error?.message === 'string' &&
      error.message.toLowerCase().includes('insert has more expressions than target columns')
    ) {
      throw ApiError.badRequest('Order verification insert configuration is invalid. Please contact support.');
    }
    throw error;
  }
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

async function claimVerificationSessionForProcessing(id) {
  const query = `
    UPDATE order_verifications
    SET status = 'processing',
        updated_at = now()
    WHERE verification_id = $1
      AND LOWER(status) = 'pending'
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [id]);
  return mapVerification(rows[0]);
}

async function updateVerificationSession(id, fields = {}) {
  const updates = [];
  const values = [];
  const payloadColumns = await getOrderVerificationPayloadColumnInfo();
  const normalized = {
    ...fields,
  };
  if (normalized.pendingOrderPayload !== undefined) {
    const payloadValue = JSON.stringify(normalized.pendingOrderPayload || {});
    if (payloadColumns.hasOrderPayload) {
      normalized.order_payload = payloadValue;
    }
    if (payloadColumns.hasPendingOrderPayload) {
      normalized.pending_order_payload = payloadValue;
    }
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
  claimVerificationSessionForProcessing,
  updateVerificationSession,
  mapVerification,
};
