import { Pool } from 'pg';
import { logger } from '../middleware/logger';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function initializeDatabase(): Promise<void> {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ DEFAULT NOW(),
      turn_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS sessions_student_idx ON sessions(student_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS conversation_turns (
      turn_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      turn_number INT NOT NULL,
      student_message TEXT,
      tutor_response TEXT,
      ai_analysis JSONB,
      modality TEXT DEFAULT 'text',
      model_used TEXT,
      latency_ms INT,
      tokens_in INT,
      tokens_out INT,
      cost_usd FLOAT DEFAULT 0,
      tools_used TEXT[],
      embedding VECTOR(384),
      topic TEXT,
      subject TEXT,
      mastery_evidenced BOOLEAN DEFAULT FALSE,
      reflection_score FLOAT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS turns_student_idx ON conversation_turns(student_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS turns_session_idx ON conversation_turns(session_id)`);

  try {
    await db.query(`
      CREATE INDEX IF NOT EXISTS turns_embedding_idx
      ON conversation_turns USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);
  } catch { /* Needs rows first */ }

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
      symbolic_knowledge JSONB DEFAULT '{}',
      ai_reflections JSONB DEFAULT '[]'
    )
  `);

  // Prompt component system tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_components (
      component_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      weight FLOAT DEFAULT 1.0,
      priority INT DEFAULT 50,
      conditions JSONB DEFAULT '[]',
      version INT DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_performance (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      component_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_number INT NOT NULL,
      student_engagement FLOAT DEFAULT 0,
      mastery_signal BOOLEAN DEFAULT FALSE,
      shame_spike BOOLEAN DEFAULT FALSE,
      frustration_spike BOOLEAN DEFAULT FALSE,
      flow_maintained BOOLEAN DEFAULT FALSE,
      answer_leak BOOLEAN DEFAULT FALSE,
      student_satisfaction FLOAT DEFAULT 0,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_experiments (
      experiment_id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL,
      variant_a TEXT NOT NULL,
      variant_b TEXT NOT NULL,
      start_date TIMESTAMPTZ DEFAULT NOW(),
      end_date TIMESTAMPTZ,
      student_split FLOAT DEFAULT 0.5,
      status TEXT DEFAULT 'running'
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_experiment_results (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      experiment_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      mastery_signals INT DEFAULT 0,
      engagement_score FLOAT DEFAULT 0,
      shame_events INT DEFAULT 0,
      frustration_events INT DEFAULT 0,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS prompt_evolution_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      component_id TEXT NOT NULL,
      old_content TEXT,
      new_content TEXT,
      old_fitness FLOAT,
      new_fitness FLOAT,
      reason TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_reflections (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      student_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_number INT NOT NULL,
      student_message TEXT,
      tutor_response TEXT,
      critique TEXT,
      improvement TEXT,
      confidence_score FLOAT,
      would_do_differently TEXT,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS spaced_reviews (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      student_id TEXT NOT NULL,
      concept TEXT NOT NULL,
      subject TEXT,
      next_review_at TIMESTAMPTZ NOT NULL,
      interval_days INT DEFAULT 1,
      review_count INT DEFAULT 0,
      mastery_level FLOAT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS spaced_reviews_student_idx ON spaced_reviews(student_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS spaced_reviews_date_idx ON spaced_reviews(next_review_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS cost_tracking (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      student_id TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_in INT NOT NULL,
      tokens_out INT NOT NULL,
      cost_usd FLOAT NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS defense_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      student_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      layer TEXT NOT NULL,
      severity TEXT NOT NULL,
      issue TEXT,
      original_response TEXT,
      revised_response TEXT,
      was_fixed BOOLEAN DEFAULT FALSE,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  logger.info('[DB] All tables initialized — WaxPrep v1.0.0');
}