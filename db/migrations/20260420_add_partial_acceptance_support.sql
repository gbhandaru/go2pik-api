-- Support partial kitchen acceptance by storing per-item availability and order-level acceptance metadata.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS acceptance_mode TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS kitchen_note TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_orders_acceptance_mode'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_orders_acceptance_mode
      CHECK (LOWER(acceptance_mode) IN ('full', 'partial'));
  END IF;
END $$;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS availability_note TEXT,
  ADD COLUMN IF NOT EXISTS marked_unavailable_at TIMESTAMPTZ;
