-- Pending order verification sessions for Twilio Verify-based OTP flow.
CREATE TABLE IF NOT EXISTS order_verifications (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  restaurant_id BIGINT NOT NULL,
  order_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  twilio_verification_sid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  resend_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  resend_available_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  order_id BIGINT,
  order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS restaurant_id BIGINT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS order_payload JSONB;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS twilio_verification_sid TEXT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS resend_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS resend_available_at TIMESTAMPTZ;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS order_id BIGINT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS order_number TEXT;

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE order_verifications
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_order_verifications_status'
      AND conrelid = 'order_verifications'::regclass
  ) THEN
    ALTER TABLE order_verifications
      ADD CONSTRAINT chk_order_verifications_status
      CHECK (LOWER(status) IN ('pending', 'processing', 'consumed', 'failed', 'expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_verifications_phone_status
  ON order_verifications (customer_phone, status);

CREATE INDEX IF NOT EXISTS idx_order_verifications_expires_at
  ON order_verifications (expires_at);
