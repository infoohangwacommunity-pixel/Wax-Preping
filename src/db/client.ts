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

  // v3.0: student_archetypes (clustering)
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_archetypes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      centroid_vector VECTOR(1536),
      member_count INT NOT NULL DEFAULT 0,
      is_discovered BOOLEAN NOT NULL DEFAULT false,
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS student_archetype_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      archetype_id UUID NOT NULL REFERENCES student_archetypes(id) ON DELETE CASCADE,
      similarity_score FLOAT NOT NULL,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(student_id, archetype_id)
    );
    CREATE INDEX IF NOT EXISTS idx_archetype_memberships_student ON student_archetype_memberships(student_id);
  `);

  // v3.0: syllabus_chunks (replaces JSON packs)
  await db.query(`
    CREATE TABLE IF NOT EXISTS syllabus_chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject TEXT NOT NULL,
      exam_board TEXT NOT NULL,
      level TEXT NOT NULL,
      topic TEXT NOT NULL,
      sub_topic TEXT NOT NULL,
      objectives TEXT[] NOT NULL DEFAULT '{}',
      exam_weight FLOAT,
      related_topics TEXT[] NOT NULL DEFAULT '{}',
      content_text TEXT NOT NULL,
      source_reference TEXT,
      embedding VECTOR(1536),
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_syllabus_embedding ON syllabus_chunks USING ivfflat (embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS idx_syllabus_subject ON syllabus_chunks(subject);
    CREATE INDEX IF NOT EXISTS idx_syllabus_exam_board ON syllabus_chunks(exam_board);
  `);

  // v3.0: tools (dynamic registry)
  await db.query(`
    CREATE TABLE IF NOT EXISTS tools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      input_schema JSONB NOT NULL,
      handler_module TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      requires_config JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools(is_enabled);
  `);

  // v3.0: observability tables
  await db.query(`
    CREATE TABLE IF NOT EXISTS attribute_extraction_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      turn_id TEXT,
      raw_llm_output JSONB NOT NULL,
      parsed_candidates JSONB NOT NULL,
      accepted_attributes JSONB NOT NULL,
      rejected_attributes JSONB NOT NULL,
      latency_ms INT,
      model_used TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_attr_logs_student ON attribute_extraction_logs(student_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tool_call_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      tool_input JSONB NOT NULL,
      tool_output JSONB,
      latency_ms INT,
      tutor_decision_reason TEXT,
      error TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tool_logs_student ON tool_call_logs(student_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tutor_decision_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      session_id TEXT,
      turn_number INT,
      decision_type TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      context_snapshot JSONB NOT NULL,
      selected_topic TEXT,
      selected_strategy TEXT,
      tools_considered TEXT[],
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_decision_logs_student ON tutor_decision_logs(student_id);
  `);

  // v3.0: onboarding_state
  await db.query(`
    CREATE TABLE IF NOT EXISTS onboarding_state (
      student_id TEXT PRIMARY KEY,
      is_complete BOOLEAN NOT NULL DEFAULT false,
      discovery_goals_satisfied JSONB NOT NULL DEFAULT '{}',
      turns_completed INT NOT NULL DEFAULT 0,
      last_goal_attempted TEXT,
      dropped_off_at_goal TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      resumed_count INT NOT NULL DEFAULT 0
    );
  `);

  // Student facts (legacy, preserved for migration)
  await db.query(`
    CREATE TABLE IF NOT EXISTS student_facts (
      student_id TEXT NOT NULL,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      confidence FLOAT DEFAULT 0.7,
      source TEXT DEFAULT 'conversation',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (student_id, fact_key)
    );
  `);

  // Notification queue (v2: +dedupe_key UNIQUE)
  await db.query(`
    CREATE TABLE IF NOT EXISTS notification_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ DEFAULT NOW(),
      sent BOOLEAN DEFAULT FALSE,
      sent_at TIMESTAMPTZ,
      priority INT DEFAULT 5,
      context JSONB DEFAULT '{}',
      dedupe_key TEXT
    );
    ALTER TABLE notification_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe_idx ON notification_queue(dedupe_key) WHERE dedupe_key IS NOT NULL;
  `);

  // Deduplication of inbound WhatsApp messages
  await db.query(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS processed_messages_time_idx ON processed_messages (processed_at);
  `);

  // v3.0: Migrate existing student_facts into student_attributes
  await db.query(`
    INSERT INTO student_attributes (
      student_id, attribute_key, attribute_value, confidence, 
      evidence_json, category, is_active
    )
    SELECT 
      student_id,
      fact_key,
      to_jsonb(fact_value),
      COALESCE(confidence, 0.7),
      jsonb_build_array(jsonb_build_object('source', COALESCE(source, 'migration'), 'timestamp', NOW())),
      CASE 
        WHEN fact_key IN ('intended_course', 'subject_interest', 'exam_type', 'target_school') THEN 'goal'
        WHEN fact_key IN ('foundation_level', 'study_habit', 'track') THEN 'cognitive_preference'
        ELSE 'contextual_factor'
      END,
      CASE WHEN COALESCE(confidence, 0.7) >= 0.6 THEN true ELSE false END
    FROM student_facts
    ON CONFLICT (student_id, attribute_key) DO NOTHING;
  `).catch(() => {});

  // Seed default archetypes and tools
  await seedDefaultArchetypes();
  await seedDefaultTools();

  logger.info('[DB] v3.0 schema initialized');
}

async function seedDefaultArchetypes(): Promise<void> {
  const archetypes = [
    {
      name: 'panic_crammer',
      description: 'High exam pressure, low time, high anxiety. Needs concise, exam-relevant content.',
      config: { rules: [{ attribute_key: 'exam_pressure', operator: 'gt', value: 0.7 }, { attribute_key: 'time_available', operator: 'lt', value: 0.3 }] },
    },
    {
      name: 'deep_diver',
      description: 'High curiosity, low exam pressure, prefers theory and connections. Needs depth and exploration room.',
      config: { rules: [{ attribute_key: 'curiosity_level', operator: 'gt', value: 0.7 }, { attribute_key: 'exam_pressure', operator: 'lt', value: 0.3 }] },
    },
    {
      name: 'homework_helper',
      description: 'Sporadic engagement, seeks quick answers. Needs bite-sized, just-in-time help.',
      config: { rules: [{ attribute_key: 'engagement_pattern', operator: 'eq', value: 'sporadic' }] },
    },
    {
      name: 'steady_builder',
      description: 'Regular engagement, methodical progress. Needs structured, scaffolded learning.',
      config: { rules: [{ attribute_key: 'engagement_pattern', operator: 'eq', value: 'regular' }] },
    },
    {
      name: 'confidence_seeker',
      description: 'Low self-efficacy, needs reassurance and small wins. Needs frequent celebration and gentle pacing.',
      config: { rules: [{ attribute_key: 'self_efficacy', operator: 'lt', value: 0.4 }] },
    },
  ];

  for (const a of archetypes) {
    await db.query(
      `INSERT INTO student_archetypes (name, description, config, is_discovered)
       VALUES ($1, $2, $3, false)
       ON CONFLICT DO NOTHING`,
      [a.name, a.description, JSON.stringify(a.config)]
    ).catch(() => {});
  }
}

async function seedDefaultTools(): Promise<void> {
  const tools = [
    {
      name: 'syllabus_query',
      description: 'Search the syllabus vector store for topics, objectives, and exam coverage.',
      input_schema: { type: 'object', properties: { subject: { type: 'string' }, query: { type: 'string' }, exam_board: { type: 'string' }, level: { type: 'string' } }, required: ['query'] },
      handler_module: 'src/tools/implementations.ts',
    },
    {
      name: 'web_search',
      description: 'Search the web for current events, real-world examples, and fresh context.',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number', default: 5 } }, required: ['query'] },
      handler_module: 'src/tools/implementations.ts',
    },
    {
      name: 'calculator',
      description: 'Evaluate mathematical expressions with step-by-step working.',
      input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      handler_module: 'src/tools/implementations.ts',
    },
    {
      name: 'code_interpreter',
      description: 'Run Python code for simulations, visualizations, and algorithmic explanations.',
      input_schema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string', default: 'python' } }, required: ['code'] },
      handler_module: 'src/tools/implementations.ts',
    },
    {
      name: 'concept_lookup',
      description: 'Define any academic term with examples and related concepts.',
      input_schema: { type: 'object', properties: { term: { type: 'string' }, subject: { type: 'string' }, context: { type: 'string' } }, required: ['term'] },
      handler_module: 'src/tools/implementations.ts',
    },
    {
      name: 'past_question_retrieval',
      description: 'Fetch WAEC/JAMB past questions for practice.',
      input_schema: { type: 'object', properties: { subject: { type: 'string' }, topic: { type: 'string' }, exam_board: { type: 'string' }, year_range: { type: 'array', items: { type: 'number' } }, limit: { type: 'number', default: 5 } }, required: ['subject', 'topic'] },
      handler_module: 'src/tools/implementations.ts',
    },
  ];

  for (const t of tools) {
    await db.query(
      `INSERT INTO tools (name, description, input_schema, handler_module, is_enabled)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (name) DO NOTHING`,
      [t.name, t.description, JSON.stringify(t.input_schema), t.handler_module]
    ).catch(() => {});
  }
}
