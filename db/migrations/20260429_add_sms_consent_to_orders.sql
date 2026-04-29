-- Store SMS opt-in consent on orders so checkout can proceed without forcing SMS.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_phone TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent_text TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent_version TEXT,
  ADD COLUMN IF NOT EXISTS sms_opt_in_source TEXT;

UPDATE orders
SET sms_consent = COALESCE(sms_consent, false)
WHERE sms_consent IS NULL;
