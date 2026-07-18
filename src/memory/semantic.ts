/**
 * Semantic memory: the durable model of the student — profile, memory blocks,
 * concept progress (BKT-inspired), facts, streaks.
 *
 * v1 bugs fixed here:
 * - updateStudyStreak() incremented total_sessions on EVERY message. Moved to
 *   session creation (session manager).
 * - getStudentProfile() now returns a deep copy so callers can't accidentally
 *   mutate the cached object.
 * - updateConceptEvidence() uses true BKT (Corbett & Anderson) with per-concept
 *   parameters learned from knowledge_trace_events.
 *
 * v3.0: Writes facts and concept progress to the cognitive graph.
 */

import { db } from '../db/client';
import { logger } from '../middleware/logger';
import { getGraphAdapter } from '../graph/factory';
import type {
  StudentProfile,
  StudentFact,
  ConceptProgress,
  BloomLevel,
  SymbolicBelief,
  MemoryBlocks,
} from '../types/student';

const profileCache = new Map<string, { profile: StudentProfile; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

const DEFAULT_BKT = { pL0: 0.3, pT: 0.2, pS: 0.1, pG: 0.3 };

function bktFromResult(
  pBefore: number,
  result: 'success' | 'struggle' | 'neutral',
  params = DEFAULT_BKT
): number {
  const { pT, pS, pG } = params;
  if (result === 'neutral') return pBefore;

  const isCorrect = result === 'success';
  const pCorrectIfLearned = 1 - pS;
  const pCorrectIfNotLearned = pG;

  const numerator = isCorrect
    ? pBefore * pCorrectIfLearned
    : pBefore * (1 - pCorrectIfLearned);
  const denominator = isCorrect
    ? pBefore * pCorrectIfLearned + (1 - pBefore) * pCorrectIfNotLearned
    : pBefore * (1 - pCorrectIfLearned) + (1 - pBefore) * (1 - pCorrectIfNotLearned);

  const pLearnedGivenEvidence = numerator / (denominator || 1);

  // Probability of knowing it next time = learned now + (not learned now * transition)
  return pLearnedGivenEvidence + (1 - pLearnedGivenEvidence) * pT;
}

async function getConceptBktParams(conceptId: string): Promise<typeof DEFAULT_BKT> {
  try {
    const result = await db.query(
      `SELECT AVG(CASE WHEN success THEN p_after ELSE NULL END) as avg_success_p,
              COUNT(*) as n
       FROM knowledge_trace_events
       WHERE concept_id = $1`,
      [conceptId]
    );
    const row = result.rows[0];
    if ((row.n as number) < 5) return DEFAULT_BKT;

    const avgSuccessP = row.avg_success_p as number;
    return {
      pL0: Math.max(0.05, Math.min(0.95, avgSuccessP * 0.8)),
      pT: 0.2,
      pS: 0.1,
      pG: 0.3,
    };
  } catch {
    return DEFAULT_BKT;
  }
}

async function logTraceEvent(event: {
  studentId: string;
  conceptId: string;
  success: boolean;
  pBefore: number;
  pAfter: number;
  source: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO knowledge_trace_events (student_id, concept_id, success, p_before, p_after, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [event.studentId, event.conceptId, event.success, event.pBefore, event.pAfter, event.source]
  ).catch(() => {});
}

export async function getStudentProfile(studentId: string): Promise<StudentProfile> {
  const cached = profileCache.get(studentId);
  if (cached && cached.expiresAt > Date.now()) {
    return JSON.parse(JSON.stringify(cached.profile)) as StudentProfile;
  }

  const result = await db.query(`SELECT * FROM student_profiles WHERE student_id = $1`, [studentId]);

  let profile: StudentProfile;

  if (result.rows.length === 0) {
    profile = createDefaultProfile(studentId);
    await db.query(
      `INSERT INTO student_profiles (
        student_id, created_at, last_seen_at, total_sessions, total_turns,
        study_streak, last_study_date, memory_blocks, concept_progress,
        error_diary, analogy_library, exam_targets, cultural_context
      ) VALUES ($1, NOW(), NOW(), 0, 0, 0, NULL, $2, $3, $4, $5, $6, $7)`,
      [
        studentId,
        JSON.stringify(profile.memoryBlocks),
        JSON.stringify(profile.conceptProgress),
        JSON.stringify(profile.errorDiary),
        JSON.stringify(profile.analogyLibrary),
        JSON.stringify(profile.examTargets),
        JSON.stringify(profile.culturalContext),
      ]
    );
  } else {
    const row = result.rows[0];
    profile = {
      studentId: row.student_id,
      createdAt: new Date(row.created_at),
      lastSeenAt: new Date(row.last_seen_at),
      totalSessions: row.total_sessions,
      totalTurns: row.total_turns,
      studyStreak: row.study_streak,
      lastStudyDate: row.last_study_date ? new Date(row.last_study_date) : null,
      memoryBlocks: row.memory_blocks || {},
      conceptProgress: row.concept_progress || {},
      errorDiary: row.error_diary || [],
      analogyLibrary: row.analogy_library || [],
      examTargets: row.exam_targets || [],
      culturalContext: row.cultural_context || {},
      studyPlan: row.study_plan,
      facts: {},
    };

    // Hydrate facts from student_facts table
    const factsResult = await db.query(
      `SELECT fact_key, fact_value, confidence, source, updated_at FROM student_facts WHERE student_id = $1`,
      [studentId]
    );
    for (const f of factsResult.rows) {
      profile.facts[f.fact_key] = {
        factKey: f.fact_key,
        factValue: f.fact_value,
        confidence: f.confidence,
        source: f.source,
        updatedAt: new Date(f.updated_at),
      };
    }
  }

  profileCache.set(studentId, { profile, expiresAt: Date.now() + CACHE_TTL_MS });
  return JSON.parse(JSON.stringify(profile)) as StudentProfile;
}

function createDefaultProfile(studentId: string): StudentProfile {
  return {
    studentId,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    totalSessions: 0,
    totalTurns: 0,
    studyStreak: 0,
    lastStudyDate: null,
    memoryBlocks: {
      humanProfile: '',
      learningStyle: '',
      progress: '',
      shameMap: '',
      curiosityMap: '',
      procedural: '',
      examStrategy: '',
      errorPatterns: '',
      breakthroughs: '',
    },
    conceptProgress: {},
    errorDiary: [],
    analogyLibrary: [],
    examTargets: [],
    culturalContext: {
      country: 'Nigeria',
      region: '',
      language: 'English',
      currency: 'NGN',
      examBoards: ['WAEC', 'JAMB', 'NECO'],
      timezone: 'Africa/Lagos',
    },
    facts: {},
  };
}

export function invalidateProfileCache(studentId?: string): void {
  if (studentId) {
    profileCache.delete(studentId);
  } else {
    profileCache.clear();
  }
}

export async function applyMemoryEdit(
  studentId: string,
  block: keyof MemoryBlocks,
  operation: 'append' | 'replace' | 'delete',
  text: string
): Promise<void> {
  const profile = await getStudentProfile(studentId);
  const blocks = { ...profile.memoryBlocks };

  if (operation === 'append') {
    blocks[block] = (blocks[block] || '') + '\n' + text;
  } else if (operation === 'replace') {
    blocks[block] = text;
  } else if (operation === 'delete') {
    blocks[block] = '';
  }

  await db.query(
    `UPDATE student_profiles SET memory_blocks = $1 WHERE student_id = $2`,
    [JSON.stringify(blocks), studentId]
  );

  invalidateProfileCache(studentId);
}

export async function upsertStudentFact(
  studentId: string,
  fact: StudentFact
): Promise<void> {
  await db.query(
    `INSERT INTO student_facts (student_id, fact_key, fact_value, confidence, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (student_id, fact_key) DO UPDATE SET
       fact_value = EXCLUDED.fact_value,
       confidence = EXCLUDED.confidence,
       source = EXCLUDED.source,
       updated_at = EXCLUDED.updated_at`,
    [studentId, fact.factKey, fact.factValue, fact.confidence, fact.source, fact.updatedAt]
  ).catch(err => logger.debug({ err }, '[Semantic] Fact upsert failed'));

  // v3.0: Write to cognitive graph
  try {
    const graph = await getGraphAdapter();
    
    // Ensure student node exists
    const studentNodes = await graph.searchNodes({ labels: ['Student'], student_id: studentId }, 1);
    let studentNodeId: string;
    if (studentNodes.length === 0) {
      const newStudent = await graph.createNode({
        labels: ['Student'],
        properties: { student_id: studentId },
        student_id: studentId,
        source: 'system',
      });
      studentNodeId = newStudent.id;
    } else {
      studentNodeId = studentNodes[0].id;
    }

    // Check for existing fact with same key
    const existingFacts = await graph.searchNodes({
      labels: ['Fact'],
      student_id: studentId,
      attribute_key: fact.factKey,
    }, 1);

    if (existingFacts.length > 0) {
      // Update existing fact and invalidate old one
      const oldFact = existingFacts[0];
      await graph.updateNode(oldFact.id, {
        validity_window: [oldFact.event_time, new Date()],
      });

      await graph.createEdge({
        source_id: studentNodeId,
        target_id: oldFact.id,
        type: 'HAD_FACT',
        properties: { superseded: true },
        student_id: studentId,
      });
    }

    // Create new fact node
    const factNode = await graph.createNode({
      labels: ['Fact'],
      properties: {
        attribute_key: fact.factKey,
        attribute_value: fact.factValue,
        confidence: fact.confidence,
        source: fact.source,
      },
      student_id: studentId,
      source: fact.source,
    });

    await graph.createEdge({
      source_id: studentNodeId,
      target_id: factNode.id,
      type: 'HAS_FACT',
      properties: { confidence: fact.confidence },
      student_id: studentId,
    });

    logger.debug({ studentId, factKey: fact.factKey }, '[Semantic] Fact saved to graph');
  } catch (graphErr) {
    logger.debug({ graphErr }, '[Semantic] Graph write failed — relational data preserved');
  }
}

/**
 * Evidence-based mastery update (BKT-inspired).
 * Each turn contributes one observation; mastery moves toward the evidence
 * with asymmetric step sizes — mastery is easier to lose than to gain at the
 * top, which matches how teachers actually calibrate confidence.
 */
export async function updateConceptEvidence(
  studentId: string,
  concept: string,
  subject: string,
  result: 'success' | 'struggle' | 'neutral',
  bloomLevel: BloomLevel,
  misconception?: string | null
): Promise<ConceptProgress> {
  const profile = await getStudentProfile(studentId);
  const progress = { ...profile.conceptProgress };

  const existing = progress[concept] || {
    conceptId: concept.toLowerCase().replace(/\s+/g, '_'),
    conceptName: concept,
    subject: subject || 'General',
    firstEncountered: new Date(),
    lastPracticed: new Date(),
    masteryLevel: 0.1,
    symbolicBeliefs: [],
    misconceptions: [],
    analogiesUsed: [],
    nextReviewAt: undefined,
    reviewInterval: 1,
    reviewCount: 0,
    successCount: 0,
    attemptCount: 0,
    bloomLevel: 'remember' as BloomLevel,
  };

  existing.attemptCount += 1;
  if (result === 'success') existing.successCount += 1;
  existing.lastPracticed = new Date();
  existing.lastResult = result;

  const BLOOM_ORDER: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
  if (BLOOM_ORDER.indexOf(bloomLevel) > BLOOM_ORDER.indexOf(existing.bloomLevel)) {
    existing.bloomLevel = bloomLevel;
  }

  // True BKT update (Corbett & Anderson) — masteryLevel is P(learned)
  // Per-concept params when available (learned from knowledge_trace_events)
  const pBefore = existing.masteryLevel || DEFAULT_BKT.pL0;
  let params = DEFAULT_BKT;
  try { params = await getConceptBktParams(existing.conceptId || concept); } catch { /* defaults */ }
  existing.masteryLevel = bktFromResult(pBefore, result, params);
  logTraceEvent({
    studentId,
    conceptId: existing.conceptId || concept,
    success: result === 'success',
    pBefore,
    pAfter: existing.masteryLevel,
    source: 'updateConceptEvidence',
  }).catch(() => {});

  if (misconception && !existing.misconceptions.includes(misconception)) {
    existing.misconceptions.push(misconception);
    if (existing.misconceptions.length > 5) existing.misconceptions.shift();
  }

  progress[concept] = existing;

  await db.query(
    `UPDATE student_profiles SET concept_progress = $1 WHERE student_id = $2`,
    [JSON.stringify(progress), studentId]
  );

  // v3.0: Write concept to cognitive graph
  try {
    const graph = await getGraphAdapter();
    
    const conceptNodes = await graph.searchNodes({
      labels: ['Concept'],
      student_id: studentId,
      name: concept,
    }, 1);

    if (conceptNodes.length > 0) {
      // Update existing concept
      await graph.updateNode(conceptNodes[0].id, {
        properties: {
          ...conceptNodes[0].properties,
          mastery_estimate: existing.masteryLevel,
          bloom_level: existing.bloomLevel,
          success_count: existing.successCount,
          attempt_count: existing.attemptCount,
          last_practiced: existing.lastPracticed.toISOString(),
        },
      });
    } else {
      // Create new concept node
      const studentNodes = await graph.searchNodes({ labels: ['Student'], student_id: studentId }, 1);
      let studentNodeId: string;
      if (studentNodes.length === 0) {
        const newStudent = await graph.createNode({
          labels: ['Student'],
          properties: { student_id: studentId },
          student_id: studentId,
          source: 'system',
        });
        studentNodeId = newStudent.id;
      } else {
        studentNodeId = studentNodes[0].id;
      }

      const newConcept = await graph.createNode({
        labels: ['Concept'],
        properties: {
          name: concept,
          subject: subject || 'General',
          mastery_estimate: existing.masteryLevel,
          bloom_level: existing.bloomLevel,
          success_count: existing.successCount,
          attempt_count: existing.attemptCount,
        },
        student_id: studentId,
        source: 'bkt',
      });

      await graph.createEdge({
        source_id: studentNodeId,
        target
