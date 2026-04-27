-- Conversational Builder V1 persistence
-- Stores thread/session state, slot resolution, decisions, and generated artifacts

CREATE TABLE IF NOT EXISTS conversation_sessions (
  thread_id UUID PRIMARY KEY,
  scenario_type VARCHAR(100) NOT NULL DEFAULT 'prb_qrxlevmin_v1',
  channel VARCHAR(50) NOT NULL DEFAULT 'appstore',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  can_generate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_conversation_status CHECK (status IN ('active', 'completed', 'reset', 'archived')),
  CONSTRAINT valid_channel CHECK (channel IN ('appstore', 'main_chat'))
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES conversation_sessions(thread_id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_role CHECK (role IN ('user', 'assistant', 'system'))
);

CREATE TABLE IF NOT EXISTS conversation_slots (
  id BIGSERIAL PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES conversation_sessions(thread_id) ON DELETE CASCADE,
  slot_key VARCHAR(100) NOT NULL,
  slot_status VARCHAR(20) NOT NULL DEFAULT 'missing',
  value_text TEXT,
  value_json JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (thread_id, slot_key),
  CONSTRAINT valid_slot_status CHECK (slot_status IN ('missing', 'resolved', 'ambiguous', 'confirmed'))
);

CREATE TABLE IF NOT EXISTS conversation_decisions (
  id BIGSERIAL PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES conversation_sessions(thread_id) ON DELETE CASCADE,
  decision_type VARCHAR(100) NOT NULL,
  decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_artifacts (
  id BIGSERIAL PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES conversation_sessions(thread_id) ON DELETE CASCADE,
  artifact_type VARCHAR(50) NOT NULL,
  artifact_status VARCHAR(50) NOT NULL DEFAULT 'created',
  file_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_artifact_type CHECK (artifact_type IN ('workflow_json', 'eiap_code', 'rapp_package')),
  CONSTRAINT valid_artifact_status CHECK (artifact_status IN ('created', 'validated', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_updated_at ON conversation_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_status ON conversation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_scenario_type ON conversation_sessions(scenario_type);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_id ON conversation_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_conversation_slots_thread_id ON conversation_slots(thread_id);
CREATE INDEX IF NOT EXISTS idx_generated_artifacts_thread_id ON generated_artifacts(thread_id);

CREATE OR REPLACE FUNCTION update_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS trg_conversation_sessions_updated_at ON conversation_sessions;
CREATE TRIGGER trg_conversation_sessions_updated_at
BEFORE UPDATE ON conversation_sessions
FOR EACH ROW EXECUTE FUNCTION update_conversation_updated_at();

DROP TRIGGER IF EXISTS trg_generated_artifacts_updated_at ON generated_artifacts;
CREATE TRIGGER trg_generated_artifacts_updated_at
BEFORE UPDATE ON generated_artifacts
FOR EACH ROW EXECUTE FUNCTION update_conversation_updated_at();
