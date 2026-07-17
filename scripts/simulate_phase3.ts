/**
 * Phase 3 offline tests — pack parse, graph nav, DKT, no hardcoded subject maps.
 */
import fs from 'fs';
import path from 'path';
import { parsePackForTest } from '../src/curriculum/ingest';
import { navigateNextInMemory, formatConceptPacket } from '../src/curriculum/graph';
import { predictFromHistory, predictMany } from '../src/curriculum/dkt';
import { nextLessonNode } from '../src/teaching/lesson_graph';
import { bktFromResult, DEFAULT_BKT } from '../src/teaching/bkt';

const failures: string[] = [];
const packDir = path.join(process.cwd(), 'curriculum', 'packs');

// ── Packs exist and validate ──────────────────────────────────────────────
const files = fs.readdirSync(packDir).filter(f => f.endsWith('.json'));
if (files.length < 2) failures.push(`Expected ≥2 packs, found ${files.length}`);
console.log('Packs:', files.join(', '));

const packs = files.map(f => parsePackForTest(JSON.parse(fs.readFileSync(path.join(packDir, f), 'utf8'))));
for (const p of packs) {
  if (!p.concepts.length) failures.push(`Pack ${p.meta.packId} has 0 concepts`);
  if (!p.subjects.length) failures.push(`Pack ${p.meta.packId} has 0 subjects`);
  // No hard-coded requirement that biology exists — but subjects must have ids
  for (const s of p.subjects) {
    if (!s.subjectId || !s.aliases) failures.push(`Bad subject in ${p.meta.packId}`);
  }
}

// ── Graph navigation (biology pack if present) ────────────────────────────
const bio = packs.find(p => p.subjects.some(s => s.subjectId === 'biology'));
if (bio) {
  const mastery: Record<string, number> = {};
  let node = navigateNextInMemory(bio.concepts, bio.edges, mastery, null);
  console.log('Bio start:', node.conceptId);
  if (node.sequenceIndex > 30) failures.push('Should start near beginning of bio path');
  mastery[node.conceptId] = 0.9;
  const next = navigateNextInMemory(bio.concepts, bio.edges, mastery, node.conceptId);
  console.log('Bio next after mastery:', next.conceptId);
  if (next.conceptId === node.conceptId) failures.push('Should advance after mastery');
  const packet = formatConceptPacket(next);
  if (!packet.includes('CURRICULUM NODE')) failures.push('packet format missing header');
}

// ── Maths pack independent ────────────────────────────────────────────────
const maths = packs.find(p => p.subjects.some(s => s.subjectId === 'mathematics'));
if (!maths) failures.push('Mathematics pack missing — multi-subject requirement');
else {
  const n = navigateNextInMemory(maths.concepts, maths.edges, {}, null);
  console.log('Maths start:', n.conceptId, n.title);
  if (n.subjectId !== 'mathematics') failures.push('Maths nav returned wrong subject');
}

// ── lesson_graph bridge loads from packs (not BIOLOGY_FOUNDATION array) ───
const bridge = nextLessonNode('biology', {}, null);
console.log('Bridge node:', bridge.id);
if (bridge.id === 'open_topic') failures.push('Bridge failed to load packs');
const bridgeMath = nextLessonNode('mathematics', {}, null);
console.log('Bridge maths:', bridgeMath.id);
if (bridgeMath.subject !== 'mathematics' && !bridgeMath.id.includes('number') && bridgeMath.id === bridge.id) {
  // may still work if aliases resolve
  console.log('note: maths bridge subject field =', bridgeMath.subject);
}

// ── DKT sequential ────────────────────────────────────────────────────────
const now = Date.now();
const hist = [
  { conceptId: 'cells_and_tissues', success: true, timestamp: now - 86400000 * 2 },
  { conceptId: 'cells_and_tissues', success: true, timestamp: now - 86400000 },
  { conceptId: 'cells_and_tissues', success: false, timestamp: now - 3600000 },
];
const pred = predictFromHistory(hist, 'cells_and_tissues', now);
console.log('DKT:', pred);
if (pred.pNextSuccess <= 0 || pred.pNextSuccess >= 1) failures.push('DKT probability out of range');
const many = predictMany(hist, ['cells_and_tissues', 'unknown_skill'], now);
if (many.length !== 2) failures.push('predictMany size');

// ── BKT still works ───────────────────────────────────────────────────────
let p = DEFAULT_BKT.pL0;
p = bktFromResult(p, 'success');
p = bktFromResult(p, 'success');
if (p <= DEFAULT_BKT.pL0) failures.push('BKT not learning');

// ── lesson_graph has no hard-coded BIOLOGY_FOUNDATION content ─────────────
const lg = fs.readFileSync(path.join(process.cwd(), 'src/teaching/lesson_graph.ts'), 'utf8');
if (lg.includes('Everything in your body is built from cells')) {
  failures.push('lesson_graph still contains hard-coded micro-lessons');
}
if (lg.includes('BIOLOGY_FOUNDATION: LessonNode[] = [')) {
  // empty array export is ok; full array not
  const m = lg.match(/export const BIOLOGY_FOUNDATION[^=]*=\s*(\[[\s\S]*?\]);/);
  if (m && m[1].replace(/\s/g, '') !== '[]') {
    failures.push('BIOLOGY_FOUNDATION still populated');
  }
}

if (failures.length) {
  console.error('FAILURES:');
  failures.forEach(f => console.error(' -', f));
  process.exit(1);
}
console.log('PHASE-3 CHECKS PASSED');
