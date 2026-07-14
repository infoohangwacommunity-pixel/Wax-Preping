-- Run this in your PostgreSQL instance before starting the app
-- The app will also run initializeDatabase() on startup which handles most of this

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  turn_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS sessions_student_id_idx ON sessions (student_id);
CREATE INDEX IF NOT EXISTS sessions_last_activity_idx ON sessions (last_activity_at);

-- Conversation turns (episodic memory)
CREATE TABLE IF NOT EXISTS conversation_turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  turn_number INT NOT NULL,
  student_message TEXT,
  tutor_response TEXT,
  emotional_snapshot JSONB,
  planner_force JSONB,
  model_used TEXT,
  latency_ms INT,
  tokens_in INT,
  tokens_out INT,
  cost_usd FLOAT,
  tools_used TEXT[],
  embedding VECTOR(384),
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS turns_student_id_idx ON conversation_turns (student_id);
CREATE INDEX IF NOT EXISTS turns_session_id_idx ON conversation_turns (session_id);
CREATE INDEX IF NOT EXISTS turns_embedding_idx ON conversation_turns
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Student profiles (semantic + procedural memory)
CREATE TABLE IF NOT EXISTS student_profiles (
  student_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  profile JSONB DEFAULT '{}'::JSONB,
  memory_blocks JSONB DEFAULT '{}'::JSONB,
  concept_progress JSONB DEFAULT '{}'::JSONB
);

-- Processed messages (deduplication)
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS processed_messages_time_idx ON processed_messages (processed_at);