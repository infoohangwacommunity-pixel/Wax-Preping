/**
 * Compatibility bridge — Phase 3.
 *
 * Hard-coded subject lesson arrays are gone. Content loads from
 * curriculum/packs/*.json (and from Postgres via curriculum/engine when online).
 */
import fs from 'fs';
import path from 'path';
import { parsePackForTest } from '../curriculum/ingest';
import { navigateNextInMemory, formatConceptPacket } from '../curriculum/graph';
import type { CurriculumConcept, CurriculumPack } from '../curriculum/schema';

/** @deprecated Use CurriculumConcept from curriculum/schema */
export interface LessonNode {
  id: string;
  subject: string;
  title: string;
  prerequisites: string[];
  microLesson: string;
  bloomTarget: 'remember' | 'understand' | 'apply';
  examTags: string[];
  localHook: string;
}

function conceptToLesson(c: CurriculumConcept, prereqs: string[] = []): LessonNode {
  return {
    id: c.conceptId,
    subject: c.subjectId,
    title: c.title,
    prerequisites: prereqs,
    microLesson: c.microLesson || c.description || c.title,
    bloomTarget: (c.bloomTarget as LessonNode['bloomTarget']) || 'understand',
    examTags: c.examTags as string[],
    localHook: c.localHooks?.[0] || '',
  };
}

function packDirs(): string[] {
  return [
    path.join(process.cwd(), 'curriculum', 'packs'),
    path.join(__dirname, '..', '..', 'curriculum', 'packs'),
  ];
}

function loadAllPacks(): CurriculumPack[] {
  const packs: CurriculumPack[] = [];
  for (const dir of packDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
      try {
        packs.push(parsePackForTest(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
      } catch { /* skip */ }
    }
    if (packs.length) break;
  }
  return packs;
}

function subjectMatches(pack: CurriculumPack, hint: string): boolean {
  const h = hint.toLowerCase();
  if (!h || h === 'general') return true;
  return pack.subjects.some(s => {
    const id = s.subjectId.toLowerCase();
    const name = s.name.toLowerCase();
    const aliases = s.aliases.map(a => a.toLowerCase());
    if (id === h || name === h || aliases.includes(h)) return true;
    if (h.includes(id) || id.includes(h)) return true;
    if (aliases.some(a => h.includes(a) || a.includes(h))) return true;
    // anatomy / medicine prep → biology packs
    if ((h.includes('anat') || h.includes('med') || h.includes('surgery')) && id === 'biology') return true;
    return false;
  });
}

function loadPackConcepts(subjectHint?: string | null): {
  concepts: CurriculumConcept[];
  edges: { fromConceptId: string; toConceptId: string; relation: string }[];
} {
  const packs = loadAllPacks();
  const hint = (subjectHint || '').toLowerCase();
  const matched = hint && hint !== 'general' ? packs.filter(p => subjectMatches(p, hint)) : packs;
  const use = matched.length ? matched : packs;

  const conceptMap = new Map<string, CurriculumConcept>();
  const edges: { fromConceptId: string; toConceptId: string; relation: string }[] = [];
  for (const p of use) {
    for (const c of p.concepts) conceptMap.set(c.conceptId, c);
    edges.push(...p.edges);
  }
  return { concepts: [...conceptMap.values()], edges };
}

export function nextLessonNode(
  subject: string | null | undefined,
  conceptProgress: Record<string, { masteryLevel?: number }>,
  currentConcept?: string | null,
  masteryThreshold = 0.65
): LessonNode {
  const { concepts, edges } = loadPackConcepts(subject);
  if (concepts.length === 0) {
    return {
      id: 'open_topic',
      subject: subject || 'general',
      title: 'Open exploration',
      prerequisites: [],
      microLesson: 'No curriculum pack loaded yet. Teach from the student goal with a tiny clear chunk.',
      bloomTarget: 'understand',
      examTags: [],
      localHook: '',
    };
  }
  const mastery: Record<string, number> = {};
  for (const [k, v] of Object.entries(conceptProgress || {})) {
    mastery[k] = v.masteryLevel ?? 0;
  }
  const c = navigateNextInMemory(concepts, edges, mastery, currentConcept, masteryThreshold);
  const prereqs = edges
    .filter(e => e.toConceptId === c.conceptId && e.relation === 'prerequisite')
    .map(e => e.fromConceptId);
  return conceptToLesson(c, prereqs);
}

export function getNode(id: string): LessonNode | null {
  const { concepts, edges } = loadPackConcepts(null);
  const c = concepts.find(x => x.conceptId === id);
  if (!c) return null;
  const prereqs = edges
    .filter(e => e.toConceptId === c.conceptId && e.relation === 'prerequisite')
    .map(e => e.fromConceptId);
  return conceptToLesson(c, prereqs);
}

export function formatLessonPacket(node: LessonNode): string {
  return formatConceptPacket({
    conceptId: node.id,
    subjectId: node.subject,
    title: node.title,
    sequenceIndex: 0,
    difficulty: 0.4,
    bloomTarget: node.bloomTarget,
    examTags: node.examTags as ('WAEC' | 'JAMB' | 'NECO' | 'NERDC' | 'GENERAL')[],
    microLesson: node.microLesson,
    localHooks: node.localHook ? [node.localHook] : [],
  });
}

/** @deprecated empty — packs replace hard-coded arrays */
export const BIOLOGY_FOUNDATION: LessonNode[] = [];
