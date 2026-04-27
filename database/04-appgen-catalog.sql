-- AppGen Agent V1 catalog tables
-- DB-backed KPI/parameter catalog seeded from dummy_data CSVs

CREATE TABLE IF NOT EXISTS appgen_catalog_items (
  id BIGSERIAL PRIMARY KEY,
  item_type VARCHAR(24) NOT NULL,
  canonical_name TEXT NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'dummy_data',
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (item_type, canonical_name)
);

CREATE TABLE IF NOT EXISTS appgen_catalog_aliases (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES appgen_catalog_items(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_appgen_alias_norm ON appgen_catalog_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_appgen_item_type ON appgen_catalog_items(item_type);

