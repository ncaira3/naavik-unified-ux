-- Telecom Knowledge Tables
-- PostgreSQL schema for Ericsson Parameters, KPI Descriptions, and RAG

-- Enable pgvector extension for embeddings (optional - install separately if needed)
-- Uncomment when pgvector is installed: CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- ERICSSON PARAMETERS
-- =====================================================
CREATE TABLE IF NOT EXISTS ericsson_parameters (
    id SERIAL PRIMARY KEY,
    model VARCHAR(255),
    mo_class VARCHAR(255),
    parameter_name VARCHAR(255) NOT NULL,
    sequence_length INTEGER,
    parameter_description TEXT,
    data_type VARCHAR(100),
    range_and_values TEXT,
    default_value TEXT,
    multiplication_factor DECIMAL(20,10),
    unit VARCHAR(50),
    resolution DECIMAL(20,10),
    read_only BOOLEAN,
    restricted BOOLEAN,
    mandatory BOOLEAN,
    persistent BOOLEAN,
    system_created BOOLEAN,
    change_take_effect TEXT,
    disturbances TEXT,
    dependencies TEXT,
    deprecated BOOLEAN,
    obsolete BOOLEAN,
    precondition TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model, mo_class, parameter_name)
);

-- Indexes for parameters
CREATE INDEX idx_param_name ON ericsson_parameters(parameter_name);
CREATE INDEX idx_param_mo_class ON ericsson_parameters(mo_class);
CREATE INDEX idx_param_model ON ericsson_parameters(model);

-- Full-text search on parameter name and description
ALTER TABLE ericsson_parameters ADD COLUMN IF NOT EXISTS tsv_param tsvector;
CREATE INDEX idx_param_fts ON ericsson_parameters USING gin(tsv_param);

CREATE OR REPLACE FUNCTION ericsson_parameters_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv_param :=
    setweight(to_tsvector('english', COALESCE(NEW.parameter_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.parameter_description, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ericsson_parameters_tsv_update BEFORE INSERT OR UPDATE
ON ericsson_parameters FOR EACH ROW EXECUTE FUNCTION ericsson_parameters_tsv_trigger();

-- =====================================================
-- ERICSSON KPI DESCRIPTIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS ericsson_kpi_descriptions (
    id SERIAL PRIMARY KEY,
    metric VARCHAR(500) NOT NULL,
    vendor VARCHAR(100),
    db_counter_name TEXT,
    description TEXT,
    category VARCHAR(100),
    poc BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for KPIs
CREATE INDEX idx_kpi_metric ON ericsson_kpi_descriptions(metric);
CREATE INDEX idx_kpi_db_counter ON ericsson_kpi_descriptions(db_counter_name);
CREATE INDEX idx_kpi_category ON ericsson_kpi_descriptions(category);

-- Full-text search on metric and description
ALTER TABLE ericsson_kpi_descriptions ADD COLUMN IF NOT EXISTS tsv_kpi tsvector;
CREATE INDEX idx_kpi_fts ON ericsson_kpi_descriptions USING gin(tsv_kpi);

CREATE OR REPLACE FUNCTION ericsson_kpi_descriptions_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv_kpi :=
    setweight(to_tsvector('english', COALESCE(NEW.metric, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.db_counter_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ericsson_kpi_descriptions_tsv_update BEFORE INSERT OR UPDATE
ON ericsson_kpi_descriptions FOR EACH ROW EXECUTE FUNCTION ericsson_kpi_descriptions_tsv_trigger();

-- =====================================================
-- TELECOM KNOWLEDGE CHUNKS (for RAG)
-- =====================================================
CREATE TABLE IF NOT EXISTS telecom_knowledge_chunks (
    id SERIAL PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('parameter', 'kpi')),
    source_id INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    metadata JSONB,
    embedding_json TEXT,  -- Store embeddings as JSON until pgvector is installed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for chunks
CREATE INDEX idx_chunks_source ON telecom_knowledge_chunks(source_type, source_id);
-- Vector index will be added after pgvector installation:
-- CREATE INDEX idx_chunks_embedding ON telecom_knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =====================================================
-- PARAMETER NATURAL LANGUAGE ALIASES
-- =====================================================
CREATE TABLE IF NOT EXISTS parameter_nl_aliases (
    id SERIAL PRIMARY KEY,
    parameter_id INTEGER NOT NULL REFERENCES ericsson_parameters(id) ON DELETE CASCADE,
    alias VARCHAR(255) NOT NULL,
    canonical_parameter_name VARCHAR(255) NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_param_alias ON parameter_nl_aliases(alias);
CREATE INDEX idx_param_alias_param_id ON parameter_nl_aliases(parameter_id);

-- Full-text search on aliases
ALTER TABLE parameter_nl_aliases ADD COLUMN IF NOT EXISTS tsv_alias tsvector;
CREATE INDEX idx_param_alias_fts ON parameter_nl_aliases USING gin(tsv_alias);

CREATE OR REPLACE FUNCTION parameter_nl_aliases_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv_alias := to_tsvector('english', COALESCE(NEW.alias, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER parameter_nl_aliases_tsv_update BEFORE INSERT OR UPDATE
ON parameter_nl_aliases FOR EACH ROW EXECUTE FUNCTION parameter_nl_aliases_tsv_trigger();

-- =====================================================
-- KPI NATURAL LANGUAGE ALIASES
-- =====================================================
CREATE TABLE IF NOT EXISTS kpi_nl_aliases (
    id SERIAL PRIMARY KEY,
    kpi_id INTEGER NOT NULL REFERENCES ericsson_kpi_descriptions(id) ON DELETE CASCADE,
    alias VARCHAR(255) NOT NULL,
    canonical_db_counter_name TEXT NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kpi_alias ON kpi_nl_aliases(alias);
CREATE INDEX idx_kpi_alias_kpi_id ON kpi_nl_aliases(kpi_id);

-- Full-text search on aliases
ALTER TABLE kpi_nl_aliases ADD COLUMN IF NOT EXISTS tsv_alias tsvector;
CREATE INDEX idx_kpi_alias_fts ON kpi_nl_aliases USING gin(tsv_alias);

CREATE OR REPLACE FUNCTION kpi_nl_aliases_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv_alias := to_tsvector('english', COALESCE(NEW.alias, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER kpi_nl_aliases_tsv_update BEFORE INSERT OR UPDATE
ON kpi_nl_aliases FOR EACH ROW EXECUTE FUNCTION kpi_nl_aliases_tsv_trigger();

-- =====================================================
-- HELPER VIEWS
-- =====================================================

-- View for parameter search with aliases
CREATE OR REPLACE VIEW parameter_search_view AS
SELECT 
    p.id,
    p.parameter_name,
    p.mo_class,
    p.parameter_description,
    p.data_type,
    p.range_and_values,
    p.default_value,
    STRING_AGG(DISTINCT a.alias, ', ') as aliases
FROM ericsson_parameters p
LEFT JOIN parameter_nl_aliases a ON p.id = a.parameter_id
GROUP BY p.id, p.parameter_name, p.mo_class, p.parameter_description, 
         p.data_type, p.range_and_values, p.default_value;

-- View for KPI search with aliases
CREATE OR REPLACE VIEW kpi_search_view AS
SELECT 
    k.id,
    k.metric,
    k.db_counter_name,
    k.description,
    k.category,
    STRING_AGG(DISTINCT a.alias, ', ') as aliases
FROM ericsson_kpi_descriptions k
LEFT JOIN kpi_nl_aliases a ON k.id = a.kpi_id
GROUP BY k.id, k.metric, k.db_counter_name, k.description, k.category;

-- Comments for documentation
COMMENT ON TABLE ericsson_parameters IS 'Ericsson network parameters from configuration management';
COMMENT ON TABLE ericsson_kpi_descriptions IS 'Ericsson KPI metrics and their descriptions';
COMMENT ON TABLE telecom_knowledge_chunks IS 'Chunked knowledge with embeddings for RAG';
COMMENT ON TABLE parameter_nl_aliases IS 'Natural language aliases for parameters';
COMMENT ON TABLE kpi_nl_aliases IS 'Natural language aliases for KPIs';
