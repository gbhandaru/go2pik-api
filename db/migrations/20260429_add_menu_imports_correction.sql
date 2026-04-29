-- Add OCR correction fields for menu import preprocessing.
ALTER TABLE menu_imports
  ADD COLUMN IF NOT EXISTS corrected_ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS correction_notes JSONB;
