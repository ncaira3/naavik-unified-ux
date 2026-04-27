-- Phase 1: Add session phase tracking, user_id, and conversation summarization support

ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS conversation_phase VARCHAR(50) NOT NULL DEFAULT 'intake',
  ADD COLUMN IF NOT EXISTS conversation_summary TEXT,
  ADD COLUMN IF NOT EXISTS spec_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON conversation_sessions(user_id);
