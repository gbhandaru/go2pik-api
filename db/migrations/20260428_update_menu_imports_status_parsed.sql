-- Extend menu import status lifecycle to include AI review states.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_menu_imports_status'
      AND conrelid = 'menu_imports'::regclass
  ) THEN
    ALTER TABLE menu_imports
      DROP CONSTRAINT chk_menu_imports_status;
  END IF;
END $$;

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
      CHECK (
        UPPER(status) IN (
          'UPLOADED',
          'OCR_PROCESSING',
          'OCR_COMPLETED',
          'AI_PROCESSING',
          'READY_FOR_REVIEW',
          'APPROVED',
          'FAILED'
        )
      );
  END IF;
END $$;
