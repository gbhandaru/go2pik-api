-- Track customer decisions after a partial kitchen acceptance.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_action TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS customer_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_action_note TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_order_status'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders DROP CONSTRAINT chk_order_status;
  END IF;

  ALTER TABLE orders
    ADD CONSTRAINT chk_order_status
    CHECK (LOWER(status) IN ('new', 'accepted', 'preparing', 'ready_for_pickup', 'completed', 'rejected', 'cancelled'));
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_order_customer_action'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_order_customer_action
      CHECK (LOWER(customer_action) IN ('none', 'pending', 'accepted', 'cancelled'));
  END IF;
END $$;
