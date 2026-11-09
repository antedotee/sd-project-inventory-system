-- Hand-written migration: things drizzle-kit cannot express from schema.ts.

-- 1. The stock ledger is append-only. A movement, once written, is a
--    historical fact; corrections are new ADJUSTMENT rows, never edits. The
--    trigger enforces this even for code or people that bypass the app.
CREATE OR REPLACE FUNCTION stock_movements_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (% is not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_block_changes();
--> statement-breakpoint

-- 2. Product search uses ILIKE '%term%' on name. A btree index cannot serve
--    a leading wildcard; a trigram GIN index can.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX products_name_trgm_idx ON products USING gin (lower(name) gin_trgm_ops);
