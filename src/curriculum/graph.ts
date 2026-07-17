/**
 * Curriculum graph navigator — data-driven next-concept selection.
 * No subject names hard-coded; works for any ingested pack.
 */
import {
  resolveSubjectId,
  listConceptsForSubject,
  getConcept,
  getPrerequisites,
  getLeadsTo,
} from './store';
import type { ConceptMasteryView, CurriculumConcept, NavigationResult } from './schema';

export interface NavigateInput {
  subjectQuery?: string | null;
  currentConceptId?: string | null;
  mastery: Record<string, ConceptMasteryView | { masteryLevel?: number }>;
  masteryThreshold?: number;
}

function masteryOf(
  mastery: NavigateInput['mastery'],
  id: string
): number {
  const m = mastery[id];
  if (!m) return 0;
  return typeof m.masteryLevel === 'number' ? m.masteryLevel : 0;
}

export async function navigateNext(input: NavigateInput): Promise<NavigationResult | null> {
  const threshold = input.masteryThreshold ?? 0.65;
  const subjectId = await resolveSubjectId(input.subjectQuery || null);
  if (!subjectId) return null;

  const concepts = await listConceptsForSubject(subjectId);
  if (concepts.length === 0) return null;

  const byId = new Map(concepts.map(c => [c.conceptId, c]));

  // If current concept known and not mastered, stay / fill prereqs
  if (input.currentConceptId && byId.has(input.currentConceptId)) {
    const cur = byId.get(input.currentConceptId)!;
    const prereqs = await getPrerequisites(cur.conceptId);
    const gaps = prereqs.filter(p => masteryOf(input.mastery, p) < threshold * 0.85);
    if (gaps.length > 0) {
      const gapConcept = (await getConcept(gaps[0])) || byId.get(gaps[0]);
      if (gapConcept) {
        return {
          concept: gapConcept,
          reason: `Prerequisite gap for ${cur.title}: teach ${gapConcept.title} first`,
          prereqGaps: gaps,
          pathPosition: position(concepts, gapConcept.conceptId),
        };
      }
    }
    if (masteryOf(input.mastery, cur.conceptId) < threshold) {
      return {
        concept: cur,
        reason: `Continue mastering ${cur.title}`,
        prereqGaps: [],
        pathPosition: position(concepts, cur.conceptId),
      };
    }
    // Advance along leads_to or sequence
    const nextIds = await getLeadsTo(cur.conceptId);
    for (const nid of nextIds) {
      if (byId.has(nid) && masteryOf(input.mastery, nid) < threshold) {
        const n = byId.get(nid)!;
        return {
          concept: n,
          reason: `Progression from ${cur.title} → ${n.title}`,
          prereqGaps: [],
          pathPosition: position(concepts, n.conceptId),
        };
      }
    }
  }

  // Global: first concept with prereqs met and mastery below threshold
  for (const c of concepts) {
    if (masteryOf(input.mastery, c.conceptId) >= threshold) continue;
    const prereqs = await getPrerequisites(c.conceptId);
    const gaps = prereqs.filter(p => masteryOf(input.mastery, p) < threshold * 0.85);
    if (gaps.length === 0) {
      return {
        concept: c,
        reason: `Next unlocked concept in ${subjectId}: ${c.title}`,
        prereqGaps: [],
        pathPosition: position(concepts, c.conceptId),
      };
    }
  }

  // All mastered — return hardest / last
  const last = concepts[concepts.length - 1];
  return {
    concept: last,
    reason: 'Path complete — review / deepen last concept',
    prereqGaps: [],
    pathPosition: position(concepts, last.conceptId),
  };
}

function position(concepts: CurriculumConcept[], id: string) {
  const index = Math.max(0, concepts.findIndex(c => c.conceptId === id));
  return { index, total: concepts.length };
}

export function formatConceptPacket(
  concept: CurriculumConcept,
  extra?: { reason?: string; prereqGaps?: string[] }
): string {
  const hook = concept.localHooks?.[0];
  return [
    `CURRICULUM NODE (from dynamic pack — teach from this when you need concrete content):`,
    `- id: ${concept.conceptId}`,
    `- subject: ${concept.subjectId}`,
    `- title: ${concept.title}`,
    concept.bloomTarget ? `- bloom: ${concept.bloomTarget}` : '',
    `- difficulty: ${concept.difficulty}`,
    concept.examTags?.length ? `- exams: ${concept.examTags.join(', ')}` : '',
    hook ? `- local hook: ${hook}` : '',
    concept.microLesson ? `- micro-lesson: ${concept.microLesson}` : '',
    concept.misconceptions?.length ? `- watch for: ${concept.misconceptions.join('; ')}` : '',
    extra?.reason ? `- navigator reason: ${extra.reason}` : '',
    extra?.prereqGaps?.length ? `- prereq gaps: ${extra.prereqGaps.join(', ')}` : '',
    `Paraphrase in warm WhatsApp voice. Do not paste robotically.`,
  ].filter(Boolean).join('\n');
}

/** Offline/in-memory navigator for tests (no DB). */
export function navigateNextInMemory(
  concepts: CurriculumConcept[],
  edges: { fromConceptId: string; toConceptId: string; relation: string }[],
  mastery: Record<string, number>,
  currentConceptId?: string | null,
  threshold = 0.65
): CurriculumConcept {
  const prereqOf = (id: string) =>
    edges.filter(e => e.toConceptId === id && e.relation === 'prerequisite').map(e => e.fromConceptId);

  const sorted = [...concepts].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  if (currentConceptId) {
    const cur = sorted.find(c => c.conceptId === currentConceptId);
    if (cur) {
      const gaps = prereqOf(cur.conceptId).filter(p => (mastery[p] || 0) < threshold * 0.85);
      if (gaps.length) {
        const g = sorted.find(c => c.conceptId === gaps[0]);
        if (g) return g;
      }
      if ((mastery[cur.conceptId] || 0) < threshold) return cur;
      const next = sorted.find(c => c.sequenceIndex > cur.sequenceIndex && (mastery[c.conceptId] || 0) < threshold);
      if (next) return next;
    }
  }

  for (const c of sorted) {
    if ((mastery[c.conceptId] || 0) >= threshold) continue;
    const gaps = prereqOf(c.conceptId).filter(p => (mastery[p] || 0) < threshold * 0.85);
    if (gaps.length === 0) return c;
  }
  return sorted[sorted.length - 1];
}
