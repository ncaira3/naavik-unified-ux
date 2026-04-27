-- Naavik Demo Database Schema - MAPPED/DUMMY VERSION
-- This schema uses the transformed column names for UI display
-- PostgreSQL 15

-- Drop existing tables if they exist
DROP TABLE IF EXISTS agent_activity_log CASCADE;
DROP TABLE IF EXISTS provisioning_history CASCADE;
DROP TABLE IF EXISTS deployed_applications CASCADE;
DROP TABLE IF EXISTS cqx_offenders_truth_table CASCADE;
DROP TABLE IF EXISTS subcomponent_table CASCADE;
DROP TABLE IF EXISTS neighbors_table_date_id CASCADE;
DROP TABLE IF EXISTS eim_table CASCADE;
DROP TABLE IF EXISTS alarm_table CASCADE;
DROP TABLE IF EXISTS ticket_table CASCADE;
DROP TABLE IF EXISTS intermediate_kpi_table CASCADE;
DROP TABLE IF EXISTS sector_table CASCADE;
DROP TABLE IF EXISTS site_table CASCADE;
DROP TABLE IF EXISTS cell_table CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- CELL TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS cell_table (
    id SERIAL PRIMARY KEY,
    "CellID" VARCHAR(255) NOT NULL,
    "SiteIDRef" VARCHAR(255),
    "CellName" VARCHAR(255),
    "NumKPIs" INTEGER,
    "Azimuth" DECIMAL(10,4),
    "Height" DECIMAL(10,4),
    "Latitude" DECIMAL(10,6),
    "Longitude" DECIMAL(11,6),
    "Technology" VARCHAR(50),
    "SiteID" VARCHAR(255),
    "Carrier" VARCHAR(50),
    "DateID" DATE,
    "AnomalyFlag" BOOLEAN DEFAULT FALSE,
    "AnomalyScore" DECIMAL(10,4) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cell_date ON cell_table("DateID");
CREATE INDEX idx_cell_siteid ON cell_table("SiteID");
CREATE INDEX idx_cell_name ON cell_table("CellName");

-- =====================================================
-- SITE TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS site_table (
    id SERIAL PRIMARY KEY,
    "SiteIDOriginal" VARCHAR(255),
    "SiteID" VARCHAR(255) NOT NULL,
    "SiteName" VARCHAR(255),
    "CellCount" INTEGER,
    "Latitude" DECIMAL(10,6),
    "Longitude" DECIMAL(11,6),
    "DateID" DATE,
    "AnomalyFlag" BOOLEAN DEFAULT FALSE,
    "AnomalyScore" DECIMAL(10,4) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_site_date ON site_table("DateID");
CREATE INDEX idx_site_siteid ON site_table("SiteID");
CREATE INDEX idx_site_anomaly ON site_table("AnomalyFlag");

-- =====================================================
-- SECTOR TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS sector_table (
    id SERIAL PRIMARY KEY,
    "SiteID" VARCHAR(255),
    "Azimuth" DECIMAL(10,4),
    site_id VARCHAR(255),
    strongest_factors TEXT,
    "AnomalyFlag" BOOLEAN DEFAULT FALSE,
    "AnomalyScore" DECIMAL(10,4) DEFAULT 0.0,
    "DateID" DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sector_date ON sector_table("DateID");
CREATE INDEX idx_sector_siteid ON sector_table("SiteID");

-- =====================================================
-- INTERMEDIATE KPI TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS intermediate_kpi_table (
    id SERIAL PRIMARY KEY,
    "KPIID" VARCHAR(255),
    "CellID" VARCHAR(255),
    "SiteIDRef" VARCHAR(255),
    "SiteID" VARCHAR(255),
    "CellName" VARCHAR(255),
    "KPIName" VARCHAR(255),
    "KPIValue" DECIMAL(20,6),
    "Technology" VARCHAR(50),
    "AnomalyFlag" BOOLEAN DEFAULT FALSE,
    "AnomalyScore" DECIMAL(10,4) DEFAULT 0.0,
    "DateID" DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kpi_date ON intermediate_kpi_table("DateID");
CREATE INDEX idx_kpi_siteid ON intermediate_kpi_table("SiteID");
CREATE INDEX idx_kpi_name ON intermediate_kpi_table("KPIName");
CREATE INDEX idx_kpi_cell ON intermediate_kpi_table("CellID");

-- =====================================================
-- TICKET TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS ticket_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    "SiteID" VARCHAR(255),
    "TicketNumber" VARCHAR(255),
    "CREATE_TIME" TIMESTAMP,
    "TICKET_STATUS" VARCHAR(100),
    "ASSIGNED_DEPARTMENT" VARCHAR(255),
    "SHORT_DESCRIPTION" TEXT,
    "MODIFIED_TIME" TIMESTAMP,
    "ASSIGNED_TO" VARCHAR(255),
    "WF_ASSIGNED_TO_CUID" VARCHAR(255),
    "CLOSED_TIME" TIMESTAMP,
    "COMMON_ID" VARCHAR(255),
    "PROBLEM_DETAIL" TEXT,
    "PROBLEM_CATEGORY" VARCHAR(255),
    "PROBLEM_SUBCATEGORY" VARCHAR(255),
    "EQUIPMENT_ID" VARCHAR(255),
    "SUBMITTED_BY" VARCHAR(255),
    "SUBMITTER_DEPARTMENT" VARCHAR(255),
    "SUBMITTER_FULL_NAME" VARCHAR(255),
    "LOCATION_ID" VARCHAR(255),
    "RANKING" INTEGER,
    "DateID" DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ticket_date ON ticket_table("DateID");
CREATE INDEX idx_ticket_siteid ON ticket_table("SiteID");

-- =====================================================
-- EIM TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS eim_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    "SiteID" VARCHAR(255),
    "AdvisoryID" VARCHAR(255),
    "DESCRIPTION_OF_WORK" TEXT,
    "COMMON_ID" VARCHAR(255),
    "LOCATION_ID" VARCHAR(255),
    "EQUIPMENT_ID" VARCHAR(255),
    "EQUIPMENT_NAME" VARCHAR(255),
    "LOCATION_NAME" VARCHAR(255),
    "ACTUAL_START_DTS" TIMESTAMP,
    "DateID" DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_eim_date ON eim_table("DateID");
CREATE INDEX idx_eim_siteid ON eim_table("SiteID");

-- =====================================================
-- SUBCOMPONENT TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS subcomponent_table (
    id SERIAL PRIMARY KEY,
    subcomponent_id VARCHAR(255),
    site_id VARCHAR(255),
    kpi_id VARCHAR(255),
    "SiteID" VARCHAR(255),
    subcomponent_name VARCHAR(255),
    subcomponent_value DECIMAL(20,6),
    operator_numerator VARCHAR(255),
    operator_denominator VARCHAR(255),
    operator_ratio DECIMAL(20,6),
    anomaly_score_ratio DECIMAL(10,4),
    "AnomalyFlag" BOOLEAN DEFAULT FALSE,
    estimated_subcomponent_num DECIMAL(20,6),
    estimated_subcomponent_den DECIMAL(20,6),
    normalized_subcomponent DECIMAL(20,6),
    normalized_estimated_subcomponent DECIMAL(20,6),
    "DateID" DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subcomp_date ON subcomponent_table("DateID");
CREATE INDEX idx_subcomp_siteid ON subcomponent_table("SiteID");

-- =====================================================
-- CQX OFFENDERS TRUTH TABLE (Mapped Schema)
-- =====================================================
CREATE TABLE IF NOT EXISTS cqx_offenders_truth_table (
    id SERIAL PRIMARY KEY,
    "DateID" DATE,
    "SiteID" VARCHAR(255),
    "TOTAL_IMPACT_LATEST" DECIMAL(20,6),
    "DL_TPUT_IMP" DECIMAL(20,6),
    "UL_TPUT_IMP" DECIMAL(20,6),
    "DATA_DROP_IMP" DECIMAL(20,6),
    "DATA_ACC_IMP" DECIMAL(20,6),
    "VRAN_ACC_IMP" DECIMAL(20,6),
    "VCDR_ACC_IMP" DECIMAL(20,6),
    "VOICE_DROP_IMP" DECIMAL(20,6),
    "NS_ESO_IMP" DECIMAL(20,6),
    "QUALITY_IMP" DECIMAL(20,6),
    "TOTAL_IMPACT_WOW" DECIMAL(20,6),
    "IMPACT_DELTA" DECIMAL(20,6),
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cqx_date ON cqx_offenders_truth_table("DateID");
CREATE INDEX idx_cqx_siteid ON cqx_offenders_truth_table("SiteID");

-- =====================================================
-- DEMO SPECIFIC TABLES
-- =====================================================

-- Table to store deployed applications (for AppGen workflow)
CREATE TABLE IF NOT EXISTS deployed_applications (
    id SERIAL PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    app_name VARCHAR(255) NOT NULL,
    app_description TEXT,
    deployment_location VARCHAR(50),
    app_logic TEXT,
    deployment_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deployed_at TIMESTAMP,
    created_by VARCHAR(255)
);

-- Table to store provisioning events (for ZTP workflow)
CREATE TABLE IF NOT EXISTS provisioning_history (
    id SERIAL PRIMARY KEY,
    provisioning_id VARCHAR(255) UNIQUE NOT NULL,
    target_site_id VARCHAR(255),
    target_siteid VARCHAR(255),
    provisioning_type VARCHAR(100),
    status VARCHAR(50),
    configuration_applied TEXT,
    initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    initiated_by VARCHAR(255),
    error_message TEXT
);

CREATE INDEX idx_prov_site ON provisioning_history(target_siteid);
CREATE INDEX idx_prov_status ON provisioning_history(status);

-- Table to store agent activity logs (for Orchestration workflow)
CREATE TABLE IF NOT EXISTS agent_activity_log (
    id SERIAL PRIMARY KEY,
    activity_id VARCHAR(255) UNIQUE NOT NULL,
    agent_name VARCHAR(50),
    activity_type VARCHAR(100),
    target_siteid VARCHAR(255),
    target_site_id VARCHAR(255),
    activity_data JSONB,
    status VARCHAR(50),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_agent_activity_time ON agent_activity_log(started_at);
CREATE INDEX idx_agent_name ON agent_activity_log(agent_name);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO naavik_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO naavik_user;
