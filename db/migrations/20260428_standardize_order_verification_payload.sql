-- Standardize order verification payload storage across old and new schema states.
-- Keep both columns during the transition so older rows and partially migrated DBs
-- continue to work while the application rollout is in progress.

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS order_payload JSONB;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS pending_order_payload JSONB;

UPDATE order_verifications
SET order_payload = COALESCE(order_payload, pending_order_payload, '{}'::jsonb);

UPDATE order_verifications
SET pending_order_payload = COALESCE(pending_order_payload, order_payload, '{}'::jsonb);

ALTER TABLE order_verifications
  ALTER COLUMN order_payload SET DEFAULT '{}'::jsonb,
  ALTER COLUMN order_payload SET NOT NULL,
  ALTER COLUMN pending_order_payload SET DEFAULT '{}'::jsonb,
  ALTER COLUMN pending_order_payload SET NOT NULL;
