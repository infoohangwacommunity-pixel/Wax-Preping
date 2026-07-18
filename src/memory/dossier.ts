/**
 * Student dossier — hierarchical memory summary.
 * v3.0: Now incorporates dynamic attributes from student_attributes table
 * alongside the static memory blocks.
 */
import { getStudentProfile } from './semantic';
import { getActiveAttributes } from '../student_profile/attribute_pipeline';
import type { StudentProfile, MemoryBlocks } from '../types/student';

export function buildStudentDossier(profile: StudentProfile, sessionState: Record<string, unknown>): string {
  const blocks = profile.memoryBlocks;
  const recentConcepts = sessionState.conceptsVisitedThisSession as string[] || [];
  const currentConcept = sessionState.currentConcept as string | null;

  const lines: string[] = [
    `STUDENT DOSSIER`,
    `---`,
    `Profile: ${blocks.humanProfile}`,
    `Learning style: ${blocks.learningStyle}`,
    `Progress: ${blocks.progress}`,
    `Shame triggers: ${blocks.shameMap}`,
    `Curiosity hooks: ${blocks.curiosityMap}`,
    `Exam strategy: ${blocks.examStrategy}`,
    `Error patterns: ${blocks.errorPatterns}`,
    `Breakthroughs: ${blocks.breakthroughs}`,
    `Procedural notes: ${blocks.procedural}`,
    `---`,
    `Current concept: ${currentConcept || 'none'}`,
    `Concepts this session: ${recentConcepts.join(', ') || 'none'}`,
    `Study streak: ${profile.studyStreak} days`,
    `Total turns: ${profile.totalTurns}`,
  ];

  if (profile.examTargets.length > 0) {
    lines.push(`Exam targets: ${profile.examTargets.map(e => `${e.examType} (${e.subjects?.join(', ')})`).join('; ')}`);
  }

  return lines.join('\n');
}

/**
 * Build a dossier that includes dynamic attributes.
 * Called by the crew when assembling context.
 */
export async function buildDynamicDossier(studentId: string, sessionState: Record<string, unknown>): Promise<string> {
  const [profile, attributes] = await Promise.all([
    getStudentProfile(studentId),
    getActiveAttributes(studentId).catch(() => ({})),
  ]);

  const base = buildStudentDossier(profile, sessionState);

  if (Object.keys(attributes).length === 0) return base;

  const attrLines = Object.entries(attributes)
    .slice(0, 15)
    .map(([key, val]) => {
      const v = typeof val === 'object' && val !== null ? (val as Record<string, unknown>).value : val;
      const c = typeof val === 'object' && val !== null ? (val as Record<string, unknown>).confidence : null;
      return `  ${key}: ${JSON.stringify(v)}${c !== null ? ` (conf: ${(c as number).toFixed(2)})` : ''}`;
    });

  return `${base}\n\nDYNAMIC ATTRIBUTES:\n${attrLines.join('\n')}`;
}
