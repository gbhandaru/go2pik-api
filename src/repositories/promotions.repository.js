const pool = require('../config/db');
const ApiError = require('../utils/errors');

function mapPromotion(row) {
  if (!row) return null;
  return {
    id: row.id,
    promoCode: row.code,
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

async function ensurePromotionSchema(client = null) {
  const executor = getExecutor(client);
  await executor.query(`
    CREATE TABLE IF NOT EXISTS promotions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'FLAT',
      discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
      max_discount_amount NUMERIC(10,2),
      min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      usage_limit_total INTEGER NOT NULL DEFAULT 1,
      restaurant_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE promotions
      ADD COLUMN IF NOT EXISTS code TEXT,
      ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'FLAT',
      ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_discount_amount NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS usage_limit_total INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS restaurant_id BIGINT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_promotions_discount_type'
          AND conrelid = 'promotions'::regclass
      ) THEN
        ALTER TABLE promotions
          ADD CONSTRAINT chk_promotions_discount_type
          CHECK (UPPER(discount_type) IN ('FLAT', 'PERCENT'));
      END IF;
    END $$;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_promotions_usage_limit_total'
          AND conrelid = 'promotions'::regclass
      ) THEN
        ALTER TABLE promotions
          ADD CONSTRAINT chk_promotions_usage_limit_total
          CHECK (usage_limit_total > 0);
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_code_upper
      ON promotions (UPPER(code));

    CREATE INDEX IF NOT EXISTS idx_promotions_active_dates
      ON promotions (is_active, start_date, end_date);

    CREATE TABLE IF NOT EXISTS promotion_usage (
      id BIGSERIAL PRIMARY KEY,
      promotion_id BIGINT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
      customer_phone TEXT NOT NULL,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE promotion_usage
      ADD COLUMN IF NOT EXISTS promotion_id BIGINT,
      ADD COLUMN IF NOT EXISTS customer_phone TEXT,
      ADD COLUMN IF NOT EXISTS order_id BIGINT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_promotion_usage_promotion_phone'
          AND conrelid = 'promotion_usage'::regclass
      ) THEN
        ALTER TABLE promotion_usage
          ADD CONSTRAINT uq_promotion_usage_promotion_phone
          UNIQUE (promotion_id, customer_phone);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_promotion_usage_promotion_id
      ON promotion_usage (promotion_id);

    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS promotion_id BIGINT,
      ADD COLUMN IF NOT EXISTS promo_code TEXT,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS final_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

    UPDATE orders
    SET final_amount = COALESCE(total_amount, 0)
    WHERE final_amount = 0
      AND total_amount IS NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_orders_promotion_id'
          AND conrelid = 'orders'::regclass
      ) THEN
        ALTER TABLE orders
          ADD CONSTRAINT fk_orders_promotion_id
          FOREIGN KEY (promotion_id) REFERENCES promotions(id);
      END IF;
    END $$;
  `);
}

async function findPromotionByCode(promoCode, client = null) {
  const executor = getExecutor(client);
  const { rows } = await executor.query(
    `SELECT * FROM promotions WHERE UPPER(code) = UPPER($1) LIMIT 1;`,
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
  ensurePromotionSchema,
  findPromotionByCode,
  findPromotionById,
  getPromotionUsageCounts,
  insertPromotionUsage,
  mapPromotion,
};
