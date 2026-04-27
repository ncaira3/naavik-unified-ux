-- Create new tables for intent-based action system
-- Run this script to add database support for queries, workflows, and simulated sites

-- Query history table
CREATE TABLE IF NOT EXISTS query_history (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  natural_query TEXT NOT NULL,
  generated_sql TEXT,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  execution_time_ms INT,
  row_count INT,
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_query_history_user_id ON query_history(user_id);
CREATE INDEX IF NOT EXISTS idx_query_history_executed_at ON query_history(executed_at DESC);

-- Workflow definitions table
CREATE TABLE IF NOT EXISTS workflows (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_config JSONB NOT NULL,
  actions JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  active BOOLEAN DEFAULT true,
  last_executed_at TIMESTAMP,
  execution_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workflows_active ON workflows(active);
CREATE INDEX IF NOT EXISTS idx_workflows_created_by ON workflows(created_by);

-- Simulated sites table (from provisioning)
CREATE TABLE IF NOT EXISTS simulated_sites (
  site_id VARCHAR(50) PRIMARY KEY,
  config JSONB NOT NULL,
  provisioned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active',
  provisioning_id VARCHAR(50),
  technology VARCHAR(10),
  cell_count INT DEFAULT 3,
  sector_count INT DEFAULT 9
);

CREATE INDEX IF NOT EXISTS idx_simulated_sites_status ON simulated_sites(status);
CREATE INDEX IF NOT EXISTS idx_simulated_sites_technology ON simulated_sites(technology);

-- Dashboard configurations table
CREATE TABLE IF NOT EXISTS dashboard_configs (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  active BOOLEAN DEFAULT true,
  access_level VARCHAR(50) DEFAULT 'private'
);

CREATE INDEX IF NOT EXISTS idx_dashboard_configs_created_by ON dashboard_configs(created_by);
CREATE INDEX IF NOT EXISTS idx_dashboard_configs_active ON dashboard_configs(active);

-- Generated code/apps table (extended)
CREATE TABLE IF NOT EXISTS generated_code (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  language VARCHAR(50) NOT NULL,
  dependencies JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  app_type VARCHAR(50) DEFAULT 'monitoring_script',
  deployed BOOLEAN DEFAULT false,
  deployed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_generated_code_created_by ON generated_code(created_by);
CREATE INDEX IF NOT EXISTS idx_generated_code_app_type ON generated_code(app_type);

-- Provisioning jobs table (for tracking ongoing provisioning)
CREATE TABLE IF NOT EXISTS provisioning_jobs (
  provisioning_id VARCHAR(50) PRIMARY KEY,
  site_id VARCHAR(50),
  status VARCHAR(50) NOT NULL,
  config JSONB NOT NULL,
  steps JSONB NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  initiated_by VARCHAR(255),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_status ON provisioning_jobs(status);
CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_site_id ON provisioning_jobs(site_id);

-- Conversation context table (for multi-turn conversations)
CREATE TABLE IF NOT EXISTS conversation_context (
  id SERIAL PRIMARY KEY,
  conversation_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(255),
  last_query TEXT,
  last_intent VARCHAR(50),
  last_results JSONB,
  context_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_conversation_context_conversation_id ON conversation_context(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_context_user_id ON conversation_context(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_context_expires_at ON conversation_context(expires_at);

-- Analysis results cache
CREATE TABLE IF NOT EXISTS analysis_cache (
  id SERIAL PRIMARY KEY,
  query_hash VARCHAR(64) UNIQUE NOT NULL,
  analysis_type VARCHAR(50) NOT NULL,
  params JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_query_hash ON analysis_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires_at ON analysis_cache(expires_at);

-- Create function to clean up expired records
CREATE OR REPLACE FUNCTION cleanup_expired_records()
RETURNS void AS $$
BEGIN
  -- Clean up expired conversation contexts
  DELETE FROM conversation_context WHERE expires_at < CURRENT_TIMESTAMP;
  
  -- Clean up expired analysis cache
  DELETE FROM analysis_cache WHERE expires_at < CURRENT_TIMESTAMP;
  
END;
$$ LANGUAGE plpgsql;

-- Create scheduled job to run cleanup (if pg_cron is available)
-- SELECT cron.schedule('cleanup-expired-records', '0 * * * *', 'SELECT cleanup_expired_records()');

-- Insert default workflows (examples)
INSERT INTO workflows (id, name, description, trigger_config, actions, active, created_by) 
VALUES 
  ('wf-001', 'High Drop Rate Alert', 'Alert when drop rate exceeds 5%', 
   '{"type":"kpi_threshold","config":{"kpi":"DATA_DROP_RATE","threshold":5.0,"operator":">","checkInterval":"5m"}}',
   '[{"type":"alert","config":{"channels":["email"],"message":"High drop rate detected","severity":"high"}}]',
   false, 'system'),
  
  ('wf-002', 'Daily Network Health Report', 'Generate daily health report', 
   '{"type":"time_based","config":{"schedule":"0 8 * * *","timezone":"UTC"}}',
   '[{"type":"analyze","config":{"analysisType":"network_health","saveResults":true}}]',
   false, 'system')
ON CONFLICT (id) DO NOTHING;

-- Grant permissions (adjust as needed)
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO naavik_user;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO naavik_user;

-- Summary
SELECT 
  'Tables created successfully!' as message,
  COUNT(*) as table_count
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'query_history', 
    'workflows', 
    'simulated_sites', 
    'dashboard_configs',
    'generated_code',
    'provisioning_jobs',
    'conversation_context',
    'analysis_cache'
  );
