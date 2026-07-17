/**
 * Curriculum Intelligence Engine — single facade used by the tutor pipeline.
 *
 * Replaces hard-coded lesson_graph subject maps with:
 *   pack ingest → store → graph navigate → concept packet
 */
import { ingestPackDirectory } from './ingest';
import { countConcepts, ensureCurriculumSchema } from './store';
import { navigateNext, formatConceptPacket } from './graph';
import type { CurriculumConcept } from './schema';
import { logger } from '../middleware/logger';

let bootstrapped = false;

/** Ensure schema + ingest packs once per process. */
export async function bootstrapCurriculum(): Promise<void> {
  if (bootstrapped) return;
  try {
    await ensureCurriculumSchema();
    const n = await countConcepts();
    if (n === 0) {
      const results = await ingestPackDirectory();
      logger.info(`[CurriculumEngine] Bootstrapped packs: ${results.filter(r => r.ok).length}`);
    }
    bootstrapped = true;
  } catch (err) {
    logger.warn({ err }, '[CurriculumEngine] Bootstrap failed — will retry next call');
  }
}

export async function recommendConcept(input: {
  subjectQuery?: string | null;
  currentConceptId?: string | null;
  conceptProgress: Record<string, { masteryLevel?: number }>;
}): Promise<{ concept: CurriculumConcept; packet: string; reason: string } | null> {
  await bootstrapCurriculum();
  const nav = await navigateNext({
    subjectQuery: input.subjectQuery,
    currentConceptId: input.currentConceptId,
    mastery: input.conceptProgress,
  });
  if (!nav) return null;
  return {
    concept: nav.concept,
    reason: nav.reason,
    packet: formatConceptPacket(nav.concept, { reason: nav.reason, prereqGaps: nav.prereqGaps }),
  };
}

export { formatConceptPacket, navigateNext, ingestPackDirectory };
