CREATE TABLE IF NOT EXISTS restaurant_order_counters (
  restaurant_id bigint PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  last_order_sequence integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
