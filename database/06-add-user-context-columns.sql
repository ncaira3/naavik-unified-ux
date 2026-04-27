-- Add user tracking and conversation context columns to conversation_sessions
-- Migration: Add user_id, conversation_phase, conversation_summary columns

ALTER TABLE conversation_sessions
ADD COLUMN IF NOT EXISTS user_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS conversation_phase VARCHAR(100) DEFAULT 'intake',
ADD COLUMN IF NOT EXISTS conversation_summary TEXT;

-- Add index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user_id ON conversation_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_phase ON conversation_sessions(conversation_phase);

-- Add is_archived column to conversation_messages for message archiving
ALTER TABLE conversation_messages
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_archived ON conversation_messages(is_archived);
