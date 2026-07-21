/**
 * WaxPrep v3.0 — Sleep Mode Consolidation Pipeline
 * Nightly background intelligence. Runs all 6 phases.
 */

import { logger } from '../middleware/logger';
import { db } from '../db/client';
import type { ConsolidationLog } from '../types/cognitive';
import { detectContradictions } from './phases';
import { extractPatterns } from './phases';
import { generateInsights } from './phases';
import { detectCommunities } from './phases';
import { reorganizeMemories } from './phases';
import { updateArchetype } from './phases';

export interface SleepModeResult {
  studentId: string;
  phasesCompleted: string[];
  phasesFailed: Array<{ phase: string; error: string }>;
  totalItemsProcessed: number;
}

/**
 * Run the full sleep mode pipeline for a student.
 */
export async function runSleepMode(studentId: string): Promise<SleepModeResult> {
  logger.info(`🌙 Sleep mode starting for student ${studentId}`);

  const result: SleepModeResult = {
    studentId,
    phasesCompleted: [],
    phasesFailed: [],
    totalItemsProcessed: 0,
  };

  const phases: Array<{ name: string; fn: (studentId: string) => Promise<number> }> = [
    { name: 'contradiction_detection', fn: detectContradictions },
    { name: 'pattern_extraction', fn: extractPatterns },
    { name: 'insight_generation', fn: generateInsights },
    { name: 'community_detection', fn: detectCommunities },
    { name: 'memory_reorganization', fn: reorganizeMemories },
    { name: 'archetype_update', fn: updateArchetype },
  ];

  for (const phase of phases) {
    const logId = await startPhaseLog(studentId, phase.name);

    try {
      const itemsProcessed = await phase.fn(studentId);
      result.phasesCompleted.push(phase.name);
      result.totalItemsProcessed += itemsProcessed;

      await completePhaseLog(logId, itemsProcessed, null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      result.phasesFailed.push({ phase: phase.name, error: errorMessage });
      logger.error({ err, studentId, phase: phase.name }, '[SleepMode] Phase failed');

      await completePhaseLog(logId, 0, errorMessage);
    }
  }

  logger.info(`🌙 Sleep mode complete for ${studentId}. Completed: ${result.phasesCompleted.length}, Failed: ${result.phasesFailed.length}`);

  return result;
}

/**
 * Run sleep mode for multiple students (batch).
 */
export async function runSleepModeBatch(studentIds: string[]): Promise<SleepModeResult[]> {
  const results: SleepModeResult[] = [];
  for (const studentId of studentIds) {
    results.push(await runSleepMode(studentId));
  }
  return results;
}

async function startPhaseLog(studentId: string, phase: string): Promise<string> {
  const result = await db.query(
    `INSERT INTO consolidation_logs (student_id, phase, started_at)
     VALUES ($1, $2, NOW())
     RETURNING id`,
    [studentId, phase]
  );
  return result.rows[0].id;
}

async function completePhaseLog(
  logId: string,
  itemsProcessed: number,
  error: string | null
): Promise<void> {
  await db.query(
    `UPDATE consolidation_logs SET
      items_processed = $1,
      completed_at = NOW(),
      error_message = $2
     WHERE id = $3`,
    [itemsProcessed, error, logId]
  );
}
