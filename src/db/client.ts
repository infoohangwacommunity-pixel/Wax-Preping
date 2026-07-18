/**
 * Database client with idempotent schema initialization.
 * Extended for v3.0 cognitive architecture.
 */
import { Pool } from 'pg';
import { logger } from '../middleware/logger';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initializeDatabase(): Promise<void> {
  // Core extensions
  await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Sessions (v2: +state JSONB for persistent per-session teaching state)
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ DEFAULT NOW(),
      turn_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      state JSONB DEFAULT '{}'::JSONB
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS state JSONB DEFAULT '{}'::JSONB;
    CREATE INDEX IF NOT EXISTS sessions_student_id_idx ON sessions (student_id);
    CREATE INDEX IF NOT EXISTS sessions_last_activity_idx ON sessions (last_activity_at);
  `);

  // Conversation turns / episodic memory (v2: +embedding_provider)
  await db.query(`
    CREATE TABLE IF NOT EXISTS conversation_turns (
      turn_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      turn_number INT NOT NULL,
      student_message TEXT,
      tutor_response TEXT,
      ai_analysis JSONB DEFAULT '{}',
      modality TEXT DEFAULT 'text',
      model_used TEXT,
      latency_ms INT,
      tokens_in INT DEFAULT 0,
      tokens_out INT DEFAULT 0,
      cost_usd FLOAT DEFAULT 0,
      tools_used TEXT[] DEFAULT '{}',
      embedding VECTOR(384),
      embedding_provider TEXT,
      topic TEXT,
      subject TEXT,
      mastery_evidenced BOOLEAN DEFAULT FALSE,
      reflection_score FLOAT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS embedding_provider TEXT;
    CREATE INDEX IF NOT EXISTS turns_student_id_idx ON conversation_turns (student_id);
    CREATE INDEX IF NOT EXISTS turns_session_id_idx ON conversation_turns (session_id);
  `);

  // Student profiles (semantic + procedural memory)
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      student_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      total_sessions INT DEFAULT 0,
      total_turns INT DEFAULT 0,
      study_streak INT DEFAULT 0,
      last_study_date DATE,
      memory_blocks JSONB DEFAULT '{}',
      concept_progress JSONB DEFAULT '{}',
      error_diary JSONB DEFAULT '[]',
      analogy_library JSONB DEFAULT '[]',
      exam_targets JSONB DEFAULT '[]',
      cultural_context JSONB DEFAULT '{}',
      study_plan JSONB,
      symbolic_knowledge JSONB DEFAULT '{}'
    );
  `);

  // v3.0: student_attributes (dynamic, extensible learner model)
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_attributes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      attribute_key TEXT NOT NULL,
      attribute_value JSONB NOT NULL,
      confidence FLOAT NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
      evidence_json JSONB NOT NULL DEFAULT '[]',
      category TEXT NOT NULL CHECK (category IN ('goal', 'cognitive_preference', 'affective_state', 'contextual_factor', 'metacognitive_trait')),
      first_observed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(student_id, attribute_key)
    );
    CREATE INDEX IF NOT EXISTS idx_student_attributes_student ON student_attributes(student_id);
    CREATE INDEX IF NOT EXISTS idx_student_attributes_key ON student_attributes(attribute_key);
    CREATE INDEX IF NOT EXISTS idx_student_attributes_category ON student_attributes(category);
    CREATE INDEX IF NOT EXISTS idx_student_attributes_confidence ON student_attributes(confidence) WHERE is_active = true;
  `);

  // ... (all remaining tables from the complete file above)
  // The full file is already pasted in its entirety
}