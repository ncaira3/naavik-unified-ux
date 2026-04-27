-- Naavik Demo Database Schema
-- PostgreSQL 15

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- CELL TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS cell_table (
    id SERIAL PRIMARY KEY,
    cell_id VARCHAR(255) UNIQUE NOT NULL,
    site_id VARCHAR(255),
    cell_name VARCHAR(255),
    num_kpis INTEGER,
    azimuth DECIMAL(10,4),
    height DECIMAL(10,4),
    latitude DECIMAL(10,6),
    longitude DECIMAL(11,6),
    tech VARCHAR(50),
    useid VARCHAR(255),
    carrier VARCHAR(50),
    neighbor_relations TEXT,
    update_time TIMESTAMP,
    version INTEGER,
    date_id DATE,
    strongest_factors TEXT,
    kpi_anomaly_flag_list TEXT,
    kpi_anomaly_score_list TEXT,
    anomaly_flag BOOLEAN DEFAULT FALSE,
    anomaly_score DECIMAL(10,4) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cell_date_id ON cell_table(date_id);
CREATE INDEX idx_cell_site_id ON cell_table(site_id);

-- =====================================================
-- SITE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS site_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255) UNIQUE NOT NULL,
    site_name VARCHAR(255),
    cell_num INTEGER,
    latitude DECIMAL(10,6),
    longitude DECIMAL(11,6),
    district VARCHAR(255),
    zone_id VARCHAR(255),
    zone_engineer VARCHAR(255),
    engineer_uid VARCHAR(255),
    manager_uid VARCHAR(255),
    county VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(100),
    street_address TEXT,
    zip VARCHAR(20),
    fa_location VARCHAR(255),
    site_type VARCHAR(100),
    structure_tower_type VARCHAR(100),
    att_site_id VARCHAR(255),
    clusterid VARCHAR(255),
    clustername VARCHAR(255),
    market VARCHAR(255),
    district_manager VARCHAR(255),
    strongest_factors TEXT,
    rca_fingerprint_reference_id VARCHAR(255),
    solution_recommendation TEXT,
    outage BOOLEAN,
    outage_timestamp TIMESTAMP,
    degraded_category VARCHAR(255),
    rca_traversal TEXT,
    rca_bucket VARCHAR(255),
    kpi_summary TEXT,
    ticket_summary TEXT,
    alarm_summary TEXT,
    rca_summary TEXT,
    short_summary TEXT,
    long_summary TEXT,
    solution_summary TEXT,
    parameter_summary TEXT,
    user_feedback TEXT,
    neighbor_summary TEXT,
    confidence_score_int INTEGER,
    date_id DATE,
    update_time TIMESTAMP,
    version INTEGER,
    outage_summary TEXT,
    intuitions TEXT,
    chain_of_thought TEXT,
    confidence_score DECIMAL(10,4),
    token_and_cost_usage TEXT,
    details TEXT,
    run_time_seconds DECIMAL(10,4),
    anomaly_flag BOOLEAN DEFAULT FALSE,
    anomaly_score DECIMAL(10,4) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_site_date_id ON site_table(date_id);
CREATE INDEX idx_site_anomaly ON site_table(anomaly_flag);

-- =====================================================
-- SECTOR TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS sector_table (
    id SERIAL PRIMARY KEY,
    azimuth DECIMAL(10,4),
    site_id VARCHAR(255),
    strongest_factors TEXT,
    anomaly_flag BOOLEAN DEFAULT FALSE,
    anomaly_score DECIMAL(10,4) DEFAULT 0.0,
    date_id DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sector_date_id ON sector_table(date_id);
CREATE INDEX idx_sector_site_id ON sector_table(site_id);

-- =====================================================
-- INTERMEDIATE KPI TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS intermediate_kpi_table (
    id SERIAL PRIMARY KEY,
    kpi_id VARCHAR(255),
    cell_id VARCHAR(255),
    site_id VARCHAR(255),
    cell_name VARCHAR(255),
    kpi_name VARCHAR(255),
    kpi_value DECIMAL(20,6),
    tech VARCHAR(50),
    anomaly_flag BOOLEAN DEFAULT FALSE,
    anomaly_score DECIMAL(10,4) DEFAULT 0.0,
    date_id DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kpi_date_id ON intermediate_kpi_table(date_id);
CREATE INDEX idx_kpi_site_id ON intermediate_kpi_table(site_id);
CREATE INDEX idx_kpi_name ON intermediate_kpi_table(kpi_name);
CREATE INDEX idx_kpi_cell_id ON intermediate_kpi_table(cell_id);

-- =====================================================
-- TICKET TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS ticket_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    ticket_number VARCHAR(255),
    create_time TIMESTAMP,
    ticket_status VARCHAR(100),
    assigned_department VARCHAR(255),
    short_description TEXT,
    modified_time TIMESTAMP,
    assigned_to VARCHAR(255),
    wf_assigned_to_cuid VARCHAR(255),
    closed_time TIMESTAMP,
    common_id VARCHAR(255),
    problem_detail TEXT,
    problem_category VARCHAR(255),
    problem_subcategory VARCHAR(255),
    equipment_id VARCHAR(255),
    submitted_by VARCHAR(255),
    submitter_department VARCHAR(255),
    submitter_full_name VARCHAR(255),
    location_id VARCHAR(255),
    ranking INTEGER,
    date_id DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ticket_date_id ON ticket_table(date_id);
CREATE INDEX idx_ticket_site_id ON ticket_table(site_id);

-- =====================================================
-- ALARM TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS alarm_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    identifier VARCHAR(255),
    agent VARCHAR(255),
    summary TEXT,
    lastoccurrence TIMESTAMP,
    site_name VARCHAR(255),
    location VARCHAR(255),
    equipmenttype VARCHAR(255),
    additionalinfo TEXT,
    deletedat TIMESTAMP,
    class_name VARCHAR(255),
    network_name VARCHAR(255),
    initialseverity_name VARCHAR(100),
    msgseverity_name VARCHAR(100),
    alarm_duration INTEGER,
    equipmentpriority INTEGER,
    clearedby VARCHAR(255),
    locmarket VARCHAR(255),
    rawdetail TEXT,
    date_id DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alarm_date_id ON alarm_table(date_id);
CREATE INDEX idx_alarm_site_id ON alarm_table(site_id);

-- =====================================================
-- EIM TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS eim_table (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    advisory_id VARCHAR(255),
    description_of_work TEXT,
    common_id VARCHAR(255),
    location_id VARCHAR(255),
    equipment_id VARCHAR(255),
    equipment_name VARCHAR(255),
    location_name VARCHAR(255),
    actual_start_dts TIMESTAMP,
    date_id DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_eim_date_id ON eim_table(date_id);
CREATE INDEX idx_eim_site_id ON eim_table(site_id);

-- =====================================================
-- NEIGHBORS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS neighbors_table_date_id (
    id SERIAL PRIMARY KEY,
    site_id VARCHAR(255),
    neighbor_site_id VARCHAR(255),
    source_site_id VARCHAR(255),
    source_site_id_face VARCHAR(255),
    neigh_site_id VARCHAR(255),
    neigh_site_id_face VARCHAR(255),
    handover_count INTEGER,
    ho_rank INTEGER,
    total_handover INTEGER,
    cummulative_sum INTEGER,
    perc_handover DECIMAL(10,4),
    source_neigh_distance_meters DECIMAL(15,2),
    date_id DATE,
    update_time TIMESTAMP,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_neighbors_date_id ON neighbors_table_date_id(date_id);
CREATE INDEX idx_neighbors_source_site_id ON neighbors_table_date_id(source_site_id);
CREATE INDEX idx_neighbors_neigh_site_id ON neighbors_table_date_id(neigh_site_id);

-- =====================================================
-- SUBCOMPONENT TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS subcomponent_table (
    id SERIAL PRIMARY KEY,
    subcomponent_id VARCHAR(255),
    site_id VARCHAR(255),
    kpi_id VARCHAR(255),
    subcomponent_name VARCHAR(255),
    subcomponent_value DECIMAL(20,6),
    operator_numerator VARCHAR(255),
    operator_denominator VARCHAR(255),
    operator_ratio DECIMAL(20,6),
    anomaly_score_ratio DECIMAL(10,4),
    anomaly_flag BOOLEAN DEFAULT FALSE,
    estimated_subcomponent_num DECIMAL(20,6),
    estimated_subcomponent_den DECIMAL(20,6),
    normalized_subcomponent DECIMAL(20,6),
    normalized_estimated_subcomponent DECIMAL(20,6),
    date_id DATE,
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subcomp_date_id ON subcomponent_table(date_id);
CREATE INDEX idx_subcomp_site_id ON subcomponent_table(site_id);

-- =====================================================
-- CQX OFFENDERS TRUTH TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS cqx_offenders_truth_table (
    id SERIAL PRIMARY KEY,
    date_id DATE,
    site_id VARCHAR(255),
    total_impact_latest DECIMAL(20,6),
    dl_tput_imp DECIMAL(20,6),
    ul_tput_imp DECIMAL(20,6),
    data_drop_imp DECIMAL(20,6),
    data_acc_imp DECIMAL(20,6),
    vran_acc_imp DECIMAL(20,6),
    vcdr_acc_imp DECIMAL(20,6),
    voice_drop_imp DECIMAL(20,6),
    ns_eso_imp DECIMAL(20,6),
    quality_imp DECIMAL(20,6),
    total_impact_wow DECIMAL(20,6),
    impact_delta DECIMAL(20,6),
    version INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cqx_date_id ON cqx_offenders_truth_table(date_id);
CREATE INDEX idx_cqx_site_id ON cqx_offenders_truth_table(site_id);

-- =====================================================
-- DEMO SPECIFIC TABLES
-- =====================================================

-- Table to store deployed applications (for AppGen workflow)
CREATE TABLE IF NOT EXISTS deployed_applications (
    id SERIAL PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    app_name VARCHAR(255) NOT NULL,
    app_description TEXT,
    deployment_location VARCHAR(50), -- 'SMO', 'NAAVIK_STORE', 'FUTURE'
    app_logic TEXT, -- The generated logic/code
    deployment_status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, DEPLOYED
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deployed_at TIMESTAMP,
    created_by VARCHAR(255)
);

-- Table to store provisioning events (for ZTP workflow)
CREATE TABLE IF NOT EXISTS provisioning_history (
    id SERIAL PRIMARY KEY,
    provisioning_id VARCHAR(255) UNIQUE NOT NULL,
    target_site_id VARCHAR(255),
    provisioning_type VARCHAR(100), -- 'ZTP', 'MANUAL', 'AUTO_REMEDIATION'
    status VARCHAR(50), -- 'INITIATED', 'IN_PROGRESS', 'COMPLETED', 'FAILED'
    configuration_applied TEXT,
    initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    initiated_by VARCHAR(255),
    error_message TEXT
);

CREATE INDEX idx_prov_site ON provisioning_history(target_site_id);
CREATE INDEX idx_prov_status ON provisioning_history(status);

-- Table to store agent activity logs (for Orchestration workflow)
CREATE TABLE IF NOT EXISTS agent_activity_log (
    id SERIAL PRIMARY KEY,
    activity_id VARCHAR(255) UNIQUE NOT NULL,
    agent_name VARCHAR(50), -- 'OBSERVATION', 'REASONING', 'PERCEPTION', 'SENSING'
    activity_type VARCHAR(100),
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
