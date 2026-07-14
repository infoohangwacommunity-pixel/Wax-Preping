import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Run this once on startup to create all tables
export async function initializeDatabase(): Promise<void> {
  await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await db.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Sessions
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

  // Conversation turns (episodic memory)
  await db.query(`
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
    )
  `);

  // Vector index for semantic search across episodic memory
  await db.query(`
    CREATE INDEX IF NOT EXISTS conversation_turns_embedding_idx
    ON conversation_turns USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  // Student profiles
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      student_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      profile JSONB DEFAULT '{}'::JSONB,
      memory_blocks JSONB DEFAULT '{}'::JSONB,
      concept_progress JSONB DEFAULT '{}'::JSONB
    )
  `);

  // Processed message IDs (deduplication)
  await db.query(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Clean old deduplication records after 24h
  await db.query(`
    CREATE INDEX IF NOT EXISTS processed_messages_time_idx
    ON processed_messages (processed_at)
  `);

  console.log("[DB] All tables initialized");
}