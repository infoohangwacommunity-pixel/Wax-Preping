// The MAC-SQL Multi-Agent Text-to-SQL System.
// Three agents work in sequence to generate safe, accurate SQL.
// The Backend Brain calls this to autonomously update the database.
// Nothing is hardcoded. The AI reads the schema and decides what to do.

import { callBrain } from './llama_server';
import { db } from '../db/client';
import { logger } from '../middleware/logger';

const DB_SCHEMA = `
TABLE: student_profiles
  student_id TEXT PK, created_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ,
  total_sessions INT, total_turns INT, study_streak INT, last_study_date DATE,
  memory_blocks JSONB, concept_progress JSONB, error_diary JSONB,
  analogy_library JSONB, exam_targets JSONB, cultural_context JSONB,
  study_plan JSONB, symbolic_knowledge JSONB

TABLE: conversation_turns
  turn_id TEXT PK, session_id TEXT, student_id TEXT, turn_number INT,
  student_message TEXT, tutor_response TEXT, ai_analysis JSONB,
  modality TEXT, model_used TEXT, latency_ms INT, tokens_in INT, tokens_out INT,
  cost_usd FLOAT, tools_used TEXT[], embedding VECTOR(384),
  topic TEXT, subject TEXT, mastery_evidenced BOOLEAN, reflection_score FLOAT, timestamp TIMESTAMPTZ

TABLE: sessions
  session_id TEXT PK, student_id TEXT, started_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ, turn_count INT, is_active BOOLEAN

TABLE: spaced_reviews
  id UUID PK, student_id TEXT, concept TEXT, subject TEXT,
  next_review_at TIMESTAMPTZ, interval_days INT, review_count INT, mastery_level FLOAT

TABLE: notification_queue
  id UUID PK, student_id TEXT, type TEXT, content TEXT,
  scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, sent BOOLEAN DEFAULT FALSE,
  priority INT DEFAULT 5, context JSONB

TABLE: world_model_state
  student_id TEXT PK, predicted_next_mistake TEXT, predicted_forget_concepts TEXT[],
  predicted_frustration_probability FLOAT, predicted_flow_probability FLOAT,
  predicted_exam_score FLOAT, predicted_exam_score_trend TEXT,
  model_updated_at TIMESTAMPTZ

TABLE: prompt_performance
  id UUID PK, component_id TEXT, student_id TEXT, session_id TEXT, turn_number INT,
  student_engagement FLOAT, mastery_signal BOOLEAN, shame_spike BOOLEAN,
  frustration_spike BOOLEAN, flow_maintained BOOLEAN, answer_leak BOOLEAN, timestamp TIMESTAMPTZ

TABLE: system_config
  key TEXT PK, content TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()

TABLE: ai_reflections
  id UUID PK, student_id TEXT, session_id TEXT, turn_number INT,
  student_message TEXT, tutor_response TEXT, critique TEXT, improvement TEXT,
  confidence_score FLOAT, would_do_differently TEXT, timestamp TIMESTAMPTZ
`;

// Agent 1: Schema Selector
// Identifies which tables are relevant to the task
async function selectRelevantSchema(task: string): Promise<string> {
  const prompt = `You are a database schema expert. A task needs SQL.
Full schema:
${DB_SCHEMA}

Task: ${task}

Which tables are needed? List ONLY the relevant table names, comma-separated. Nothing else.`;

  const response = await callBrain(prompt, 0.1, 100);
  const tableNames = response.split(',').map(t => t.trim()).filter(Boolean);

  // Return only relevant schema sections
  const lines = DB_SCHEMA.split('\n');
  const relevant: string[] = [];
  let capture = false;

  for (const line of lines) {
    if (line.startsWith('TABLE:')) {
      const tableName = line.replace('TABLE:', '').trim();
      capture = tableNames.some(t => tableName.includes(t));
    }
    if (capture && line.trim()) {
      relevant.push(line);
    }
  }

  return relevant.join('\n') || DB_SCHEMA;
}

// Agent 2: Query Decomposer
// Breaks the task into SQL steps with chain-of-thought
async function decomposeToSQL(task: string, relevantSchema: string): Promise<string[]> {
  const prompt = `You are a PostgreSQL expert for a Nigerian student tutoring system.

Relevant database schema:
${relevantSchema}

Task: ${task}

Think step by step. Break this into individual SQL statements.
Important rules:
- Use parameterized queries where possible ($1, $2 notation)
- For JSONB updates use jsonb_set()
- For arrays use array operations
- Never use DROP, TRUNCATE, or DELETE without WHERE clause
- For student notifications, insert into notification_queue
- All timestamps use TIMESTAMPTZ and NOW()

Respond with a JSON array of SQL strings:
["SQL1", "SQL2", "SQL3"]`;

  const response = await callBrain(prompt, 0.2, 800);

  try {
    const cleaned = response.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as string[];
  } catch {
    // Extract SQL manually if JSON parsing fails
    const sqlMatches = response.match(/SELECT|INSERT|UPDATE|DELETE[^;]+;/gi) || [];
    return sqlMatches;
  }
}

// Agent 3: SQL Refiner
// Validates and refines SQL before execution
async function refineSql(sqls: string[], task: string, relevantSchema: string): Promise<string[]> {
  if (sqls.length === 0) return [];

  const prompt = `You are a PostgreSQL safety validator.

Schema:
${relevantSchema}

Task: ${task}

Generated SQL:
${sqls.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Check each SQL for:
1. Syntax errors
2. Using columns that do not exist in schema
3. Missing WHERE clauses on UPDATE/DELETE
4. JSONB path correctness
5. Queries that would affect 0 rows (wrong conditions)

Return the corrected SQL array. If a query is fine, keep it as is. If wrong, fix it.
Respond with JSON array of corrected SQL strings only:
["corrected_SQL1", "corrected_SQL2"]`;

  const response = await callBrain(prompt, 0.1, 800);

  try {
    const cleaned = response.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as string[];
  } catch {
    return sqls; // Return original if refinement fails
  }
}

// Execute SQL with safety checks
async function executeSqlSafely(sql: string): Promise<{ success: boolean; rowsAffected: number; error?: string }> {
  const dangerous = /DROP TABLE|TRUNCATE|DELETE FROM \w+ WHERE 1=1/i;
  if (dangerous.test(sql)) {
    logger.error('[SQLAgent] Dangerous SQL blocked:', sql);
    return { success: false, rowsAffected: 0, error: 'Dangerous operation blocked by safety filter' };
  }

  try {
    const result = await db.query(sql);
    return { success: true, rowsAffected: result.rowCount || 0 };
  } catch (err) {
    logger.error('[SQLAgent] SQL execution failed:', { sql, err });
    return { success: false, rowsAffected: 0, error: (err as Error).message };
  }
}

// Main entry point: Text-to-SQL pipeline
export async function executeAutonomousTask(task: string): Promise<{
  success: boolean;
  sqlsGenerated: string[];
  sqlsExecuted: number;
  rowsAffected: number;
  errors: string[];
}> {
  logger.info('[SQLAgent] Task:', task);

  const relevantSchema = await selectRelevantSchema(task);
  const decomposed = await decomposeToSQL(task, relevantSchema);

  if (decomposed.length === 0) {
    return { success: false, sqlsGenerated: [], sqlsExecuted: 0, rowsAffected: 0, errors: ['No SQL generated'] };
  }

  const refined = await refineSql(decomposed, task, relevantSchema);
  const errors: string[] = [];
  let totalRowsAffected = 0;
  let executed = 0;

  for (const sql of refined) {
    const result = await executeSqlSafely(sql);
    if (result.success) {
      totalRowsAffected += result.rowsAffected;
      executed++;
    } else {
      errors.push(result.error || 'Unknown error');
      logger.warn('[SQLAgent] SQL failed:', { sql, error: result.error });
    }
  }

  return {
    success: errors.length === 0,
    sqlsGenerated: refined,
    sqlsExecuted: executed,
    rowsAffected: totalRowsAffected,
    errors,
  };
}