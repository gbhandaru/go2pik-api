const pool = require('../config/db');
const ApiError = require('../utils/errors');

function mapPromotion(row) {
  if (!row) return null;
  return {
    id: row.id,
    promoCode: row.promo_code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    maxDiscountAmount: row.max_discount_amount === null || row.max_discount_amount === undefined
      ? null
      : Number(row.max_discount_amount),
    minOrderAmount: Number(row.min_order_amount || 0),
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: Boolean(row.is_active),
    usageLimitTotal: Number(row.usage_limit_total || 0),
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : Number(row.restaurant_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getExecutor(client) {
  return client || pool;
}

async function findPromotionByCode(promoCode, client = null) {
  const executor = getExecutor(client);
  const { rows } = await executor.query(
    `
      SELECT *
      FROM promotions
      WHERE UPPER(promo_code) = UPPER($1)
      LIMIT 1;
    `,
    [promoCode]
  );
  return mapPromotion(rows[0]);
}

async function findPromotionById(promotionId, client = null, { forUpdate = false } = {}) {
  const executor = getExecutor(client);
  const query = `
    SELECT *
    FROM promotions
    WHERE id = $1
    ${forUpdate ? 'FOR UPDATE' : 'LIMIT 1'}
  `;
  const { rows } = await executor.query(query, [promotionId]);
  return mapPromotion(rows[0]);
}

async function getPromotionUsageCounts(promotionId, customerPhone, client = null) {
  const executor = getExecutor(client);
  const { rows } = await executor.query(
    `
      SELECT
        COUNT(*)::int AS total_usage,
        COUNT(*) FILTER (WHERE customer_phone = $2)::int AS phone_usage
      FROM promotion_usage
      WHERE promotion_id = $1;
    `,
    [promotionId, customerPhone]
  );
  return {
    totalUsage: Number(rows[0]?.total_usage || 0),
    phoneUsage: Number(rows[0]?.phone_usage || 0),
  };
}

async function insertPromotionUsage(client, { promotionId, customerPhone, orderId }) {
  try {
    const { rows } = await client.query(
      `
        INSERT INTO promotion_usage (
          promotion_id,
          customer_phone,
          order_id
        )
        VALUES ($1, $2, $3)
        RETURNING *;
      `,
      [promotionId, customerPhone, orderId]
    );
    return rows[0] || null;
  } catch (error) {
    if (error?.code === '23505') {
      console.warn('[promotions.repository] promotion usage insert conflict', {
        promotionId,
        customerPhone,
        orderId,
        constraint: error.constraint || null,
      });
      throw ApiError.conflict('Promo code already used for this phone number');
    }
    console.error('[promotions.repository] promotion usage insert failed', {
      promotionId,
      customerPhone,
      orderId,
      code: error?.code,
      message: error?.message,
    });
    throw error;
  }
}

module.exports = {
  findPromotionByCode,
  findPromotionById,
  getPromotionUsageCounts,
  insertPromotionUsage,
  mapPromotion,
};
