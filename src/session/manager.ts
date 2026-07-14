import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import type { Session, ConversationTurn } from "../types/student";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function getOrCreateSession(studentId: string): Promise<Session> {
  // Look for an active session within the timeout window
  const result = await db.query(
    `SELECT * FROM sessions
     WHERE student_id = $1
       AND last_activity_at > NOW() - INTERVAL '30 minutes'
       AND is_active = TRUE
     ORDER BY last_activity_at DESC
     LIMIT 1`,
    [studentId]
  );

  if (result.rows.length > 0) {
    const row = result.rows[0];
    const history = await getSessionHistory(row.session_id);
    return {
      sessionId: row.session_id,
      studentId: row.student_id,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      turnCount: row.turn_count,
      conversationHistory: history,
      currentTopicTrail: [],
      isActive: true,
    };
  }

  // No active session — create a new one
  const sessionId = uuidv4();
  await db.query(
    `INSERT INTO sessions (session_id, student_id) VALUES ($1, $2)`,
    [sessionId, studentId]
  );

  return {
    sessionId,
    studentId,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    turnCount: 0,
    conversationHistory: [],
    currentTopicTrail: [],
    isActive: true,
  };
}

export async function touchSession(sessionId: string): Promise<void> {
  await db.query(
    `UPDATE sessions
     SET last_activity_at = NOW(), turn_count = turn_count + 1
     WHERE session_id = $1`,
    [sessionId]
  );
}

export async function getSessionHistory(
  sessionId: string,
  limit = 10
): Promise<ConversationTurn[]> {
  const result = await db.query(
    `SELECT * FROM conversation_turns
     WHERE session_id = $1
     ORDER BY turn_number DESC
     LIMIT $2`,
    [sessionId, limit]
  );

  return result.rows.reverse().map((row) => ({
    turnId: row.turn_id,
    sessionId: row.session_id,
    studentId: row.student_id,
    turnNumber: row.turn_number,
    studentMessage: row.student_message,
    tutorResponse: row.tutor_response,
    emotionalSnapshot: row.emotional_snapshot,
    plannerForce: row.planner_force,
    modelUsed: row.model_used,
    latencyMs: row.latency_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd,
    toolsUsed: row.tools_used || [],
    timestamp: row.timestamp,
  }));
}

export async function saveTurn(turn: ConversationTurn): Promise<void> {
  await db.query(
    `INSERT INTO conversation_turns (
      turn_id, session_id, student_id, turn_number,
      student_message, tutor_response, emotional_snapshot,
      planner_force, model_used, latency_ms, tokens_in,
      tokens_out, cost_usd, tools_used, timestamp
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      turn.turnId,
      turn.sessionId,
      turn.studentId,
      turn.turnNumber,
      turn.studentMessage,
      turn.tutorResponse,
      JSON.stringify(turn.emotionalSnapshot),
      turn.plannerForce ? JSON.stringify(turn.plannerForce) : null,
      turn.modelUsed,
      turn.latencyMs,
      turn.tokensIn,
      turn.tokensOut,
      turn.costUsd,
      turn.toolsUsed,
      turn.timestamp,
    ]
  );
}

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM processed_messages WHERE message_id = $1`,
    [messageId]
  );
  return result.rows.length > 0;
}

export async function markMessageProcessed(messageId: string): Promise<void> {
  await db.query(
    `INSERT INTO processed_messages (message_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [messageId]
  );
  // Clean up old records (older than 2 hours)
  await db.query(
    `DELETE FROM processed_messages WHERE processed_at < NOW() - INTERVAL '2 hours'`
  );
}