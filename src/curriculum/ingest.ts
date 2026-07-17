/**
 * Curriculum pack ingestion.
 *
 * Packs are JSON documents (see curriculum/packs/*.json).
 * No subjects are hard-coded in TS — adding a subject = drop a pack file + ingest.
 *
 * Sources researched (Phase 3):
 * - NERDC e-Curriculum portal: official but NOT a public machine API (login/browse only)
 * - JAMB brochure / WAEC syllabus: PDF/human-readable, not structured API
 * - questions.africa / questions.ng: past-question APIs (topics derivable, not full syllabus)
 * - Electric Sheep Africa synthetic education datasets: subject offerings, not concept graphs
 *
 * Decision: versioned JSON curriculum packs under curriculum/packs/, validated + upserted
 * into Postgres. Future: scraper/worker can pull NERDC/WAEC PDFs → LLM structure → pack.
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../middleware/logger';
import { upsertPack, ensureCurriculumSchema, countConcepts } from './store';
import type { CurriculumPack, CurriculumConcept, CurriculumEdge, CurriculumSubject } from './schema';

export interface IngestResult {
  packId: string;
  subjects: number;
  concepts: number;
  edges: number;
  ok: boolean;
  error?: string;
}

function validatePack(raw: unknown): CurriculumPack {
  const p = raw as CurriculumPack;
  if (!p?.meta?.packId || !p.meta.version || !p.meta.title || !p.meta.source) {
    throw new Error('Invalid pack meta (need packId, version, title, source)');
  }
  if (!Array.isArray(p.subjects) || !Array.isArray(p.concepts) || !Array.isArray(p.edges)) {
    throw new Error('Pack must include subjects[], concepts[], edges[]');
  }
  for (const c of p.concepts) {
    if (!c.conceptId || !c.subjectId || !c.title) throw new Error(`Invalid concept: ${JSON.stringify(c)}`);
  }
  return p;
}

/** Normalize edges: if only prerequisites listed on concepts, expand. */
function expandImplicitEdges(pack: CurriculumPack): CurriculumPack {
  const edges = [...pack.edges];
  const seen = new Set(edges.map(e => `${e.fromConceptId}>${e.toConceptId}>${e.relation}`));
  // If concepts have sequenceIndex, add soft leads_to between consecutive same-subject
  const bySubject = new Map<string, CurriculumConcept[]>();
  for (const c of pack.concepts) {
    const list = bySubject.get(c.subjectId) || [];
    list.push(c);
    bySubject.set(c.subjectId, list);
  }
  for (const [, list] of bySubject) {
    const sorted = [...list].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i].conceptId;
      const to = sorted[i + 1].conceptId;
      const key = `${from}>${to}>prerequisite`;
      // consecutive sequence implies earlier is prereq of later
      if (!seen.has(key)) {
        edges.push({ fromConceptId: from, toConceptId: to, relation: 'prerequisite', weight: 0.8 });
        seen.add(key);
      }
      const leadKey = `${from}>${to}>leads_to`;
      if (!seen.has(leadKey)) {
        edges.push({ fromConceptId: from, toConceptId: to, relation: 'leads_to', weight: 0.8 });
        seen.add(leadKey);
      }
    }
  }
  return { ...pack, edges };
}

export async function ingestPackObject(raw: unknown): Promise<IngestResult> {
  try {
    let pack = validatePack(raw);
    pack = expandImplicitEdges(pack);
    await upsertPack(pack);
    return {
      packId: pack.meta.packId,
      subjects: pack.subjects.length,
      concepts: pack.concepts.length,
      edges: pack.edges.length,
      ok: true,
    };
  } catch (err) {
    return {
      packId: 'unknown',
      subjects: 0,
      concepts: 0,
      edges: 0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function ingestPackFile(filePath: string): Promise<IngestResult> {
  const text = fs.readFileSync(filePath, 'utf8');
  const raw = JSON.parse(text);
  const result = await ingestPackObject(raw);
  if (result.ok) logger.info(`[CurriculumIngest] ${path.basename(filePath)} → ${result.concepts} concepts`);
  else logger.warn(`[CurriculumIngest] Failed ${filePath}: ${result.error}`);
  return result;
}

/**
 * Load all *.json packs from a directory (default: curriculum/packs relative to cwd or dist).
 */
export async function ingestPackDirectory(dir?: string): Promise<IngestResult[]> {
  await ensureCurriculumSchema();
  const candidates = [
    dir,
    path.join(process.cwd(), 'curriculum', 'packs'),
    path.join(process.cwd(), 'dist', '..', 'curriculum', 'packs'),
    path.join(__dirname, '..', '..', 'curriculum', 'packs'),
  ].filter(Boolean) as string[];

  let packDir: string | null = null;
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      packDir = c;
      break;
    }
  }
  if (!packDir) {
    logger.warn('[CurriculumIngest] No curriculum/packs directory found');
    return [];
  }

  const files = fs.readdirSync(packDir).filter(f => f.endsWith('.json')).sort();
  const results: IngestResult[] = [];
  for (const f of files) {
    results.push(await ingestPackFile(path.join(packDir, f)));
  }
  const n = await countConcepts();
  logger.info(`[CurriculumIngest] Total concepts in store: ${n}`);
  return results;
}

/** In-memory ingest for tests / offline (no DB) — returns normalized pack. */
export function parsePackForTest(raw: unknown): CurriculumPack {
  return expandImplicitEdges(validatePack(raw));
}

export type { CurriculumPack, CurriculumConcept, CurriculumSubject, CurriculumEdge };
