-- Set the initial status for new orders to the client-visible workflow state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_order_status'
      AND conrelid = 'orders'::regclass
  ) THEN
    EXECUTE 'ALTER TABLE orders DROP CONSTRAINT chk_order_status';
  END IF;

  UPDATE orders
  SET status = 'new'
  WHERE LOWER(status) = 'pending';

  ALTER TABLE orders
    ALTER COLUMN status SET DEFAULT 'new';

  EXECUTE '
    ALTER TABLE orders
    ADD CONSTRAINT chk_order_status
    CHECK (LOWER(status) IN (''new'', ''accepted'', ''preparing'', ''ready_for_pickup'', ''completed'', ''rejected''))
  ';
END $$;
