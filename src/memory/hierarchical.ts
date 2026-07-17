/**
 * Hierarchical memory consolidation.
 *
 * Layers:
 *   working  — last ~12 turns (episodic table, hot)
 *   recent   — session summaries in memory_blocks.progress
 *   durable  — facts + concept_progress + humanProfile
 *   archive  — epoch_* keys written by compressor for >90d turns
 *
 * This module does not delete aggressively. It ranks and promotes.
 */

import { db } from '../db/client';
import { routeAndCall } from '../llm/router';
import { getPrompt } from '../config/prompts';
import { logger } from '../middleware/logger';
import { applyMemoryEdit } from './semantic';

/**
 * Promote high-value recent turns into durable narrative memory.
 * Call from the compressor worker or post-session hooks.
 */
export async function consolidateRecentMemory(studentId: string): Promise<void> {
  try {
    const recent = await db.query(
      `SELECT student_message, tutor_response, topic, mastery_evidenced, timestamp
       FROM conversation_turns
       WHERE student_id = $1
       ORDER BY timestamp DESC LIMIT 30`,
      [studentId]
    );
    if (recent.rows.length < 8) return;

    const text = recent.rows
      .reverse()
      .map((r: Record<string, unknown>) => {
        const m = r.mastery_evidenced ? '✓' : '·';
        return `${m} [${r.topic || '?'}] S:${String(r.student_message || '').slice(0, 70)} | T:${String(r.tutor_response || '').slice(0, 70)}`;
      })
      .join('\n');

    const instruction = await getPrompt('memory_compressor.v1');
    const summary = await routeAndCall(
      [
        { role: 'system', content: instruction + '\nFocus on durable student traits, goals, and mastery shifts — not chat fluff.' },
        { role: 'user', content: text },
      ],
      { tier: 'deep', maxTokens: 350, studentId, purpose: 'memory_consolidate' }
    );

    if (summary.content && summary.content.length > 40) {
      await applyMemoryEdit(studentId, 'progress', 'append', summary.content.slice(0, 500));
      logger.info(`[HierarchicalMemory] Consolidated recent memory for ${studentId}`);
    }
  } catch (err) {
    logger.debug({ err }, '[HierarchicalMemory] consolidate failed');
  }
}
