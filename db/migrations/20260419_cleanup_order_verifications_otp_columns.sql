-- Cleanup legacy local-OTP columns now that Twilio Verify is the source of truth.
ALTER TABLE order_verifications
  DROP COLUMN IF EXISTS otp_hash,
  DROP COLUMN IF EXISTS otp_last_sent_at;
