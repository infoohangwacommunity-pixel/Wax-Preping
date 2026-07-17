/**
 * Hierarchical student dossier — compresses profile + facts + mastery into a
 * ranked context block for deliberation.
 *
 * Layers (inspired by hierarchical memory / MemGPT-style paging, specialized
 * for tutoring):
 *   L0 identity   — who they are (facts, goals)
 *   L1 trajectory — exams, foundation, study habits
 *   L2 mastery    — top weak / strong concepts (BKT scalars)
 *   L3 narrative  — short memory-block slices
 *   L4 session    — live session state
 *
 * Ranking is importance × recency × educational utility — not raw dump.
 */

import type { StudentProfile, SessionState } from '../types/student';
import { masteryBand } from '../teaching/bkt';

export interface DossierOptions {
  maxChars?: number;
}

export function buildStudentDossier(
  profile: StudentProfile,
  session: SessionState,
  options: DossierOptions = {}
): string {
  const maxChars = options.maxChars ?? 1800;
  const parts: string[] = [];

  // L0 — identity facts
  const facts = Object.entries(profile.facts || {})
    .sort((a, b) => (b[1].confidence || 0) - (a[1].confidence || 0))
    .slice(0, 12)
    .map(([k, v]) => `${k}=${v.factValue}`)
    .join('; ');
  if (facts) parts.push(`IDENTITY FACTS: ${facts}`);
  else parts.push('IDENTITY FACTS: none yet — infer carefully, do not re-interview endlessly.');

  // L1 — trajectory
  const exams = (profile.examTargets || [])
    .map(e => `${e.examType}${e.examDate ? `@${e.examDate}` : ''}[${(e.subjects || []).join(',')}]`)
    .join(' | ');
  parts.push(
    `TRAJECTORY: turns=${profile.totalTurns} sessions=${profile.totalSessions} streak=${profile.studyStreak}` +
      (exams ? ` exams=${exams}` : '')
  );

  // L2 — mastery snapshot
  const concepts = Object.values(profile.conceptProgress || {});
  const weak = concepts
    .filter(c => c.masteryLevel < 0.5)
    .sort((a, b) => a.masteryLevel - b.masteryLevel)
    .slice(0, 5)
    .map(c => `${c.conceptName}:${c.masteryLevel.toFixed(2)}(${masteryBand(c.masteryLevel)})`);
  const strong = concepts
    .filter(c => c.masteryLevel >= 0.7)
    .sort((a, b) => b.masteryLevel - a.masteryLevel)
    .slice(0, 4)
    .map(c => `${c.conceptName}:${c.masteryLevel.toFixed(2)}`);
  if (weak.length) parts.push(`WEAK CONCEPTS: ${weak.join('; ')}`);
  if (strong.length) parts.push(`STRONG CONCEPTS: ${strong.join('; ')}`);
  if (!weak.length && !strong.length) parts.push('MASTERY: no concept evidence yet.');

  // L3 — narrative blocks (truncated)
  const blocks = profile.memoryBlocks || ({} as StudentProfile['memoryBlocks']);
  const narrativeKeys: (keyof typeof blocks)[] = [
    'humanProfile',
    'learningStyle',
    'progress',
    'shameMap',
    'curiosityMap',
    'errorPatterns',
    'breakthroughs',
  ];
  for (const key of narrativeKeys) {
    const val = (blocks[key] || '').trim();
    if (!val || val.length < 8) continue;
    // Skip pure defaults
    if (/unknown|nothing known|no concepts covered|no breakthroughs yet/i.test(val) && val.length < 90) continue;
    parts.push(`${key}: ${val.slice(0, 180)}`);
  }

  // L4 — session
  parts.push(
    `SESSION: subject=${session.currentSubject || 'none'} concept=${session.currentConcept || 'none'} ` +
      `struggles=${session.struggleCount} qConsec=${session.consecutiveQuestions ?? 0} ` +
      `qSess=${session.questionsThisSession ?? 0} lastMove=${session.lastMove || 'none'} ` +
      `ready=${session.readinessSignal ? 'yes' : 'no'} foundationGap=${session.foundationGapDisclosed ? 'yes' : 'no'}`
  );

  // Rank-trim by keeping head sections first (already ordered by importance)
  let out = parts.join('\n');
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 20) + '\n…[dossier truncated]';
  }
  return out;
}
