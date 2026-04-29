-- Phase 1 AI menu import staging for OCR-only ingestion.
CREATE TABLE IF NOT EXISTS menu_imports (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADED',
  raw_ocr_text TEXT,
  parsed_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE menu_imports
  ADD COLUMN IF NOT EXISTS restaurant_id BIGINT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS raw_ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS parsed_json JSONB,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_menu_imports_status'
      AND conrelid = 'menu_imports'::regclass
  ) THEN
    ALTER TABLE menu_imports
      ADD CONSTRAINT chk_menu_imports_status
      CHECK (UPPER(status) IN ('UPLOADED', 'OCR_PROCESSING', 'OCR_COMPLETED', 'FAILED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_menu_imports_restaurant_id
  ON menu_imports (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_menu_imports_status
  ON menu_imports (status);

CREATE INDEX IF NOT EXISTS idx_menu_imports_created_at
  ON menu_imports (created_at DESC);
