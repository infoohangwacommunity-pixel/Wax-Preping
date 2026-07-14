// Episodic memory: the tutor's memory of past conversations.
// Stored in PostgreSQL with pgvector for semantic search.
// The tutor can recall relevant past moments even without the student mentioning them.

import { db } from "../db/client";
import type { ConversationTurn } from "../types/student";

// This is a lightweight local embedding using character-level hashing.
// Replace with a real embedding model (HuggingFace, OpenAI, etc.) in production.
// The interface is the same. Only this function changes.
async function embed(text: string): Promise<number[]> {
  // Placeholder: returns a 384-dim zero vector
  // In production: call HuggingFace inference API or local model
  // e.g., GET https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2
  const dim = 384;
  const vector = new Array(dim).fill(0);

  // Simple hashing to make it non-zero for testing
  for (let i = 0; i < Math.min(text.length, dim); i++) {
    vector[i] = text.charCodeAt(i) / 255;
  }

  return vector;
}

// Save a turn to episodic memory with its semantic embedding
export async function saveEpisode(turn: ConversationTurn): Promise<void> {
  const textToEmbed = `${turn.studentMessage} ${turn.tutorResponse}`;
  const embedding = await embed(textToEmbed);
  const embeddingStr = `[${embedding.join(",")}]`;

  await db.query(
    `INSERT INTO conversation_turns (
      turn_id, session_id, student_id, turn_number,
      student_message, tutor_response, emotional_snapshot,
      planner_force, model_used, latency_ms, tokens_in,
      tokens_out, cost_usd, tools_used, embedding, timestamp
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector,$16)
    ON CONFLICT (turn_id) DO NOTHING`,
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
      embeddingStr,
      turn.timestamp,
    ]
  );
}

// Recall semantically relevant past moments for a student
export async function recallRelevantEpisodes(
  studentId: string,
  query: string,
  limit = 5
): Promise<ConversationTurn[]> {
  const embedding = await embed(query);
  const embeddingStr = `[${embedding.join(",")}]`;

  const result = await db.query(
    `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM conversation_turns
     WHERE student_id = $2
       AND embedding IS NOT NULL
     ORDER BY similarity DESC
     LIMIT $3`,
    [embeddingStr, studentId, limit]
  );

  return result.rows.map((row) => ({
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