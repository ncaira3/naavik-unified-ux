-- Automation Platform Database Schema Extensions
-- Creates tables for intent-based automation, app generation, and ENM integration
-- Author: Naavik Platform Team
-- Date: 2026-02-05

\echo 'Creating automation platform tables...'

-- Parameter Table: Store Ericsson parameters from ericsson_parameters.xlsx
CREATE TABLE IF NOT EXISTS parameter_table (
  parameter_id SERIAL PRIMARY KEY,
  model VARCHAR(255),
  mo_class VARCHAR(255),
  parameter_name VARCHAR(255) NOT NULL,
  parameter_description TEXT,
  data_type VARCHAR(100),
  range_values TEXT,
  default_value VARCHAR(255),
  multiplication_factor VARCHAR(50),
  unit VARCHAR(50),
  resolution VARCHAR(50),
  read_only BOOLEAN DEFAULT false,
  restricted BOOLEAN DEFAULT false,
  mandatory BOOLEAN DEFAULT false,
  persistent BOOLEAN DEFAULT true,
  system_created BOOLEAN DEFAULT false,
  change_take_effect VARCHAR(255),
  disturbances TEXT,
  dependencies TEXT,
  deprecated BOOLEAN DEFAULT false,
  obsolete BOOLEAN DEFAULT false,
  precondition TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_parameter_mo_class ON parameter_table(mo_class);
CREATE INDEX IF NOT EXISTS idx_parameter_name ON parameter_table(parameter_name);
CREATE INDEX IF NOT EXISTS idx_parameter_model ON parameter_table(model);
CREATE INDEX IF NOT EXISTS idx_parameter_search ON parameter_table USING gin(to_tsvector('english', parameter_name || ' ' || COALESCE(parameter_description, '')));

\echo 'parameter_table created successfully!'

-- Generated App Table: Store EIAP applications
CREATE TABLE IF NOT EXISTS generated_app_table (
  app_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name VARCHAR(255) NOT NULL,
  description TEXT,
  natural_language_input TEXT,
  generated_code TEXT,
  workflow_json JSONB,
  mo_classes TEXT[],
  parameters_used TEXT[],
  kpis_used TEXT[],
  status VARCHAR(50) DEFAULT 'draft',
  deployment_target VARCHAR(100) DEFAULT 'ERICSSON_EIAP',
  created_by VARCHAR(255),
  is_predefined BOOLEAN DEFAULT false,
  execution_count INTEGER DEFAULT 0,
  last_executed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('draft', 'validated', 'deployed', 'running', 'failed', 'archived')),
  CONSTRAINT valid_deployment_target CHECK (deployment_target IN ('ERICSSON_EIAP', 'NOKIA_EDEN', 'AIRA_NATIVE', 'NAAVIK_STORE'))
);

-- Create indexes for app queries
CREATE INDEX IF NOT EXISTS idx_app_status ON generated_app_table(status);
CREATE INDEX IF NOT EXISTS idx_app_deployment_target ON generated_app_table(deployment_target);
CREATE INDEX IF NOT EXISTS idx_app_created_by ON generated_app_table(created_by);
CREATE INDEX IF NOT EXISTS idx_app_created_at ON generated_app_table(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_predefined ON generated_app_table(is_predefined);
CREATE INDEX IF NOT EXISTS idx_app_search ON generated_app_table USING gin(to_tsvector('english', app_name || ' ' || COALESCE(description, '')));

\echo 'generated_app_table created successfully!'

-- Automation Execution Log: Track all automation runs
CREATE TABLE IF NOT EXISTS automation_execution_log (
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES generated_app_table(app_id) ON DELETE CASCADE,
  execution_type VARCHAR(50) NOT NULL,
  triggered_by VARCHAR(255),
  trigger_source VARCHAR(50),
  cmhandle_ids TEXT[],
  sites_affected TEXT[],
  cells_affected TEXT[],
  parameters_changed JSONB,
  kpis_checked JSONB,
  execution_status VARCHAR(50) DEFAULT 'running',
  report_data JSONB,
  error_message TEXT,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  duration_ms INTEGER,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  CONSTRAINT valid_execution_type CHECK (execution_type IN ('manual', 'scheduled', 'chat_action', 'api_trigger', 'test_run')),
  CONSTRAINT valid_trigger_source CHECK (trigger_source IN ('chat', 'appstore', 'api', 'scheduler', 'test')),
  CONSTRAINT valid_execution_status CHECK (execution_status IN ('running', 'completed', 'failed', 'cancelled', 'partial'))
);

-- Create indexes for execution log queries
CREATE INDEX IF NOT EXISTS idx_execution_app_id ON automation_execution_log(app_id);
CREATE INDEX IF NOT EXISTS idx_execution_status ON automation_execution_log(execution_status);
CREATE INDEX IF NOT EXISTS idx_execution_started_at ON automation_execution_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_triggered_by ON automation_execution_log(triggered_by);
CREATE INDEX IF NOT EXISTS idx_execution_trigger_source ON automation_execution_log(trigger_source);

\echo 'automation_execution_log created successfully!'

-- Action Button Definitions: Define actionable buttons for reports
CREATE TABLE IF NOT EXISTS action_button_definitions (
  action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name VARCHAR(255) NOT NULL UNIQUE,
  action_description TEXT,
  trigger_conditions JSONB,
  app_id UUID REFERENCES generated_app_table(app_id) ON DELETE SET NULL,
  button_label VARCHAR(255) NOT NULL,
  button_style VARCHAR(50) DEFAULT 'primary',
  button_icon VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  requires_confirmation BOOLEAN DEFAULT true,
  estimated_duration_minutes INTEGER,
  risk_level VARCHAR(50) DEFAULT 'medium',
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_button_style CHECK (button_style IN ('primary', 'secondary', 'warning', 'danger', 'success')),
  CONSTRAINT valid_risk_level CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);

-- Create indexes for action queries
CREATE INDEX IF NOT EXISTS idx_action_app_id ON action_button_definitions(app_id);
CREATE INDEX IF NOT EXISTS idx_action_active ON action_button_definitions(is_active);
CREATE INDEX IF NOT EXISTS idx_action_category ON action_button_definitions(category);
CREATE INDEX IF NOT EXISTS idx_action_risk_level ON action_button_definitions(risk_level);

\echo 'action_button_definitions created successfully!'

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
DROP TRIGGER IF EXISTS update_parameter_updated_at ON parameter_table;
CREATE TRIGGER update_parameter_updated_at 
BEFORE UPDATE ON parameter_table 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_updated_at ON generated_app_table;
CREATE TRIGGER update_app_updated_at 
BEFORE UPDATE ON generated_app_table 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_action_updated_at ON action_button_definitions;
CREATE TRIGGER update_action_updated_at 
BEFORE UPDATE ON action_button_definitions 
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

\echo 'Triggers created successfully!'

-- Create a view for app execution statistics
CREATE OR REPLACE VIEW app_execution_stats AS
SELECT 
  a.app_id,
  a.app_name,
  a.status,
  a.execution_count,
  a.last_executed_at,
  COUNT(e.execution_id) as total_runs,
  COUNT(CASE WHEN e.execution_status = 'completed' THEN 1 END) as successful_runs,
  COUNT(CASE WHEN e.execution_status = 'failed' THEN 1 END) as failed_runs,
  AVG(e.duration_ms) as avg_duration_ms,
  MAX(e.started_at) as last_run_at
FROM generated_app_table a
LEFT JOIN automation_execution_log e ON a.app_id = e.app_id
GROUP BY a.app_id, a.app_name, a.status, a.execution_count, a.last_executed_at;

\echo 'app_execution_stats view created successfully!'

-- Grant permissions (adjust user as needed)
GRANT SELECT, INSERT, UPDATE, DELETE ON parameter_table TO naavik_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON generated_app_table TO naavik_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON automation_execution_log TO naavik_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_button_definitions TO naavik_user;
GRANT USAGE, SELECT ON SEQUENCE parameter_table_parameter_id_seq TO naavik_user;
GRANT SELECT ON app_execution_stats TO naavik_user;

\echo 'Permissions granted successfully!'
\echo 'Automation platform tables setup complete!'
