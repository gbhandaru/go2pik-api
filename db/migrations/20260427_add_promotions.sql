-- Promotions support for launch promo validation and order-level usage tracking.
CREATE TABLE IF NOT EXISTS promotions (
  id BIGSERIAL PRIMARY KEY,
  promo_code TEXT NOT NULL,
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
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_promo_code_upper
  ON promotions (UPPER(promo_code));

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
  ADD COLUMN IF NOT EXISTS promotion_id BIGINT NOT NULL,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS order_id BIGINT NOT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

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
