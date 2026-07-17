/**
 * Lightweight teaching-quality metrics.
 *
 * Tracks the signals that actually matter for WaxPrep:
 *   - question rate vs teach rate
 *   - policy moves used
 *   - defense hits
 *   - latency
 *
 * Stored in teaching_metrics (created on first write). Powers future
 * prompt-evolution fitness beyond generic engagement scores.
 */

import { db } from '../db/client';
import { logger } from '../middleware/logger';

let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS teaching_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_number INT,
      asked_question BOOLEAN DEFAULT FALSE,
      taught_content BOOLEAN DEFAULT FALSE,
      policy_move TEXT,
      strategy TEXT,
      defense_issues INT DEFAULT 0,
      latency_ms INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await db.query(`
    CREATE INDEX IF NOT EXISTS teaching_metrics_student_idx
    ON teaching_metrics (student_id, created_at DESC)
  `).catch(() => {});
  ensured = true;
}

export interface TurnMetric {
  studentId: string;
  sessionId: string;
  turnNumber: number;
  askedQuestion: boolean;
  taughtContent: boolean;
  policyMove?: string | null;
  strategy?: string | null;
  defenseIssues?: number;
  latencyMs?: number;
}

export async function recordTurnMetric(m: TurnMetric): Promise<void> {
  try {
    await ensureTable();
    await db.query(
      `INSERT INTO teaching_metrics
       (student_id, session_id, turn_number, asked_question, taught_content, policy_move, strategy, defense_issues, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        m.studentId,
        m.sessionId,
        m.turnNumber,
        m.askedQuestion,
        m.taughtContent,
        m.policyMove || null,
        m.strategy || null,
        m.defenseIssues || 0,
        m.latencyMs || null,
      ]
    );
  } catch (err) {
    logger.debug({ err }, '[Metrics] record failed');
  }
}

export async function getStudentTeachStats(
  studentId: string,
  lastN = 50
): Promise<{ questionRate: number; teachRate: number; samples: number }> {
  try {
    await ensureTable();
    const r = await db.query(
      `SELECT asked_question, taught_content FROM teaching_metrics
       WHERE student_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [studentId, lastN]
    );
    const n = r.rows.length || 1;
    const q = r.rows.filter((x: { asked_question: boolean }) => x.asked_question).length;
    const t = r.rows.filter((x: { taught_content: boolean }) => x.taught_content).length;
    return { questionRate: q / n, teachRate: t / n, samples: r.rows.length };
  } catch {
    return { questionRate: 0, teachRate: 0, samples: 0 };
  }
}
