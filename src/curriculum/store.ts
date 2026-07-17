/**
 * Curriculum store — Postgres-backed, pack-versioned.
 * Tables are created lazily on first use (additive, migration-safe).
 */
import { db } from '../db/client';
import { logger } from '../middleware/logger';
import type {
  CurriculumConcept,
  CurriculumEdge,
  CurriculumPack,
  CurriculumPackMeta,
  CurriculumSubject,
} from './schema';

let ready = false;

export async function ensureCurriculumSchema(): Promise<void> {
  if (ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS curriculum_packs (
      pack_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      license TEXT,
      boards TEXT[] DEFAULT '{}',
      levels TEXT[] DEFAULT '{}',
      raw_meta JSONB DEFAULT '{}',
      imported_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS curriculum_subjects (
      subject_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT[] DEFAULT '{}',
      boards TEXT[] DEFAULT '{}',
      levels TEXT[] DEFAULT '{}',
      pack_id TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS curriculum_concepts (
      concept_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      sequence_index INT DEFAULT 0,
      difficulty FLOAT DEFAULT 0.5,
      bloom_target TEXT,
      exam_tags TEXT[] DEFAULT '{}',
      objectives JSONB DEFAULT '[]',
      misconceptions JSONB DEFAULT '[]',
      local_hooks JSONB DEFAULT '[]',
      micro_lesson TEXT,
      keywords TEXT[] DEFAULT '{}',
      pack_id TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS curriculum_concepts_subject_idx ON curriculum_concepts (subject_id, sequence_index)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS curriculum_edges (
      from_concept_id TEXT NOT NULL,
      to_concept_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight FLOAT DEFAULT 1.0,
      pack_id TEXT,
      PRIMARY KEY (from_concept_id, to_concept_id, relation)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS bkt_concept_params (
      concept_id TEXT PRIMARY KEY,
      p_l0 FLOAT DEFAULT 0.1,
      p_t FLOAT DEFAULT 0.15,
      p_g FLOAT DEFAULT 0.2,
      p_s FLOAT DEFAULT 0.1,
      sample_size INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS knowledge_trace_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      p_before FLOAT,
      p_after FLOAT,
      source TEXT DEFAULT 'tutor',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS kte_student_idx ON knowledge_trace_events (student_id, created_at DESC)`);
  ready = true;
  logger.info('[CurriculumStore] Schema ready');
}

export async function upsertPack(pack: CurriculumPack): Promise<void> {
  await ensureCurriculumSchema();
  const m = pack.meta;
  await db.query(
    `INSERT INTO curriculum_packs (pack_id, version, title, source, source_url, license, boards, levels, raw_meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (pack_id) DO UPDATE SET
       version = EXCLUDED.version, title = EXCLUDED.title, source = EXCLUDED.source,
       source_url = EXCLUDED.source_url, license = EXCLUDED.license,
       boards = EXCLUDED.boards, levels = EXCLUDED.levels, raw_meta = EXCLUDED.raw_meta,
       imported_at = NOW()`,
    [m.packId, m.version, m.title, m.source, m.sourceUrl || null, m.license || null, m.boards, m.levels, JSON.stringify(m)]
  );

  for (const s of pack.subjects) {
    await db.query(
      `INSERT INTO curriculum_subjects (subject_id, name, aliases, boards, levels, pack_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (subject_id) DO UPDATE SET
         name = EXCLUDED.name, aliases = EXCLUDED.aliases, boards = EXCLUDED.boards,
         levels = EXCLUDED.levels, pack_id = EXCLUDED.pack_id, updated_at = NOW()`,
      [s.subjectId, s.name, s.aliases, s.boards, s.levels, m.packId]
    );
  }

  for (const c of pack.concepts) {
    await db.query(
      `INSERT INTO curriculum_concepts
       (concept_id, subject_id, title, description, sequence_index, difficulty, bloom_target,
        exam_tags, objectives, misconceptions, local_hooks, micro_lesson, keywords, pack_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (concept_id) DO UPDATE SET
         subject_id = EXCLUDED.subject_id, title = EXCLUDED.title, description = EXCLUDED.description,
         sequence_index = EXCLUDED.sequence_index, difficulty = EXCLUDED.difficulty,
         bloom_target = EXCLUDED.bloom_target, exam_tags = EXCLUDED.exam_tags,
         objectives = EXCLUDED.objectives, misconceptions = EXCLUDED.misconceptions,
         local_hooks = EXCLUDED.local_hooks, micro_lesson = EXCLUDED.micro_lesson,
         keywords = EXCLUDED.keywords, pack_id = EXCLUDED.pack_id, updated_at = NOW()`,
      [
        c.conceptId, c.subjectId, c.title, c.description || null, c.sequenceIndex, c.difficulty,
        c.bloomTarget || null, c.examTags, JSON.stringify(c.objectives || []),
        JSON.stringify(c.misconceptions || []), JSON.stringify(c.localHooks || []),
        c.microLesson || null, c.keywords || [], m.packId,
      ]
    );
  }

  for (const e of pack.edges) {
    await db.query(
      `INSERT INTO curriculum_edges (from_concept_id, to_concept_id, relation, weight, pack_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (from_concept_id, to_concept_id, relation) DO UPDATE SET
         weight = EXCLUDED.weight, pack_id = EXCLUDED.pack_id`,
      [e.fromConceptId, e.toConceptId, e.relation, e.weight ?? 1, m.packId]
    );
  }
}

function rowToConcept(r: Record<string, unknown>): CurriculumConcept {
  return {
    conceptId: r.concept_id as string,
    subjectId: r.subject_id as string,
    title: r.title as string,
    description: (r.description as string) || undefined,
    sequenceIndex: Number(r.sequence_index) || 0,
    difficulty: Number(r.difficulty) || 0.5,
    bloomTarget: (r.bloom_target as CurriculumConcept['bloomTarget']) || undefined,
    examTags: (r.exam_tags as CurriculumConcept['examTags']) || [],
    objectives: (r.objectives as string[]) || [],
    misconceptions: (r.misconceptions as string[]) || [],
    localHooks: (r.local_hooks as string[]) || [],
    microLesson: (r.micro_lesson as string) || undefined,
    keywords: (r.keywords as string[]) || [],
  };
}

export async function resolveSubjectId(query: string | null | undefined): Promise<string | null> {
  if (!query) return null;
  await ensureCurriculumSchema();
  const q = query.toLowerCase().trim();
  const r = await db.query(
    `SELECT subject_id FROM curriculum_subjects
     WHERE lower(subject_id) = $1 OR lower(name) = $1 OR $1 = ANY (SELECT lower(unnest(aliases)))
     LIMIT 1`,
    [q]
  ).catch(() => ({ rows: [] as { subject_id: string }[] }));
  if (r.rows[0]) return r.rows[0].subject_id;

  // Fuzzy: alias contains / name contains
  const r2 = await db.query(
    `SELECT subject_id FROM curriculum_subjects
     WHERE lower(name) LIKE '%' || $1 || '%'
        OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) LIKE '%' || $1 || '%')
     LIMIT 1`,
    [q]
  ).catch(() => ({ rows: [] as { subject_id: string }[] }));
  return r2.rows[0]?.subject_id || null;
}

export async function listConceptsForSubject(subjectId: string): Promise<CurriculumConcept[]> {
  await ensureCurriculumSchema();
  const r = await db.query(
    `SELECT * FROM curriculum_concepts WHERE subject_id = $1 ORDER BY sequence_index ASC, title ASC`,
    [subjectId]
  );
  return r.rows.map(rowToConcept);
}

export async function getConcept(conceptId: string): Promise<CurriculumConcept | null> {
  await ensureCurriculumSchema();
  const r = await db.query(`SELECT * FROM curriculum_concepts WHERE concept_id = $1`, [conceptId]);
  return r.rows[0] ? rowToConcept(r.rows[0]) : null;
}

export async function getPrerequisites(conceptId: string): Promise<string[]> {
  await ensureCurriculumSchema();
  const r = await db.query(
    `SELECT from_concept_id FROM curriculum_edges
     WHERE to_concept_id = $1 AND relation = 'prerequisite'`,
    [conceptId]
  );
  return r.rows.map((x: { from_concept_id: string }) => x.from_concept_id);
}

export async function getLeadsTo(conceptId: string): Promise<string[]> {
  await ensureCurriculumSchema();
  const r = await db.query(
    `SELECT to_concept_id FROM curriculum_edges
     WHERE from_concept_id = $1 AND relation IN ('leads_to', 'prerequisite')`,
    [conceptId]
  );
  // If edge stored as prerequisite A->B meaning A before B, leads_to from A is B
  const r2 = await db.query(
    `SELECT to_concept_id FROM curriculum_edges WHERE from_concept_id = $1 AND relation = 'leads_to'`,
    [conceptId]
  );
  const set = new Set<string>([
    ...r.rows.map((x: { to_concept_id: string }) => x.to_concept_id),
    ...r2.rows.map((x: { to_concept_id: string }) => x.to_concept_id),
  ]);
  // Also: nodes that list this as prerequisite
  const r3 = await db.query(
    `SELECT to_concept_id FROM curriculum_edges WHERE from_concept_id = $1 AND relation = 'prerequisite'`,
    [conceptId]
  );
  for (const row of r3.rows) set.add(row.to_concept_id);
  return [...set];
}

export async function listPacks(): Promise<CurriculumPackMeta[]> {
  await ensureCurriculumSchema();
  const r = await db.query(`SELECT * FROM curriculum_packs ORDER BY imported_at DESC`);
  return r.rows.map((row: Record<string, unknown>) => ({
    packId: row.pack_id as string,
    version: row.version as string,
    title: row.title as string,
    source: row.source as string,
    sourceUrl: (row.source_url as string) || undefined,
    license: (row.license as string) || undefined,
    boards: (row.boards as CurriculumPackMeta['boards']) || [],
    levels: (row.levels as CurriculumPackMeta['levels']) || [],
    importedAt: row.imported_at ? new Date(row.imported_at as string).toISOString() : undefined,
  }));
}

export async function countConcepts(): Promise<number> {
  await ensureCurriculumSchema();
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM curriculum_concepts`);
  return r.rows[0]?.n || 0;
}

export async function listAllSubjects(): Promise<CurriculumSubject[]> {
  await ensureCurriculumSchema();
  const r = await db.query(`SELECT * FROM curriculum_subjects ORDER BY name`);
  return r.rows.map((s: Record<string, unknown>) => ({
    subjectId: s.subject_id as string,
    name: s.name as string,
    aliases: (s.aliases as string[]) || [],
    boards: (s.boards as CurriculumSubject['boards']) || [],
    levels: (s.levels as CurriculumSubject['levels']) || [],
  }));
}
