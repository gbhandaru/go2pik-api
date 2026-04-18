ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_deleted_at
  ON menu_items (restaurant_id, deleted_at);
