/**
 * Student Archetype System — Layer 3 of the Dynamic Student Profile.
 *
 * Phase 1 (N < 100): Rule-based matching against config-driven archetypes.
 * Phase 2 (N >= 100): Unsupervised clustering (stubbed, ready for activation).
 *
 * Archetypes are used to:
 * 1. Warm-start new students with tentative attributes.
 * 2. Generate persona-specific prompt modifiers.
 * 3. Predict at-risk students based on archetype-specific patterns.
 */
import { db } from '../db/client';
import { logger } from '../middleware/logger';
import { getActiveAttributes } from './attribute_pipeline';

export interface ArchetypeMatch {
  archetypeId: string;
  name: string;
  description: string;
  similarityScore: number;
  isPrimary: boolean;
}

/**
 * Match a student to archetypes based on their active attributes.
 * Returns the best match and any secondary matches above threshold.
 */
export async function matchArchetypes(studentId: string): Promise<ArchetypeMatch[]> {
  const archetypes = await loadArchetypes();
  if (archetypes.length === 0) return [];

  const attributes = await getActiveAttributes(studentId);
  const matches: ArchetypeMatch[] = [];

  for (const archetype of archetypes) {
    if (archetype.is_discovered) continue;
    const score = computeRuleBasedScore(archetype.config, attributes);
    if (score > 0.3) {
      matches.push({
        archetypeId: archetype.id,
        name: archetype.name,
        description: archetype.description,
        similarityScore: score,
        isPrimary: false,
      });
    }
  }

  matches.sort((a, b) => b.similarityScore - a.similarityScore);

  if (matches.length > 0) {
    matches[0].isPrimary = true;
  }

  await saveMemberships(studentId, matches);
  await updateStudentArchetypeSummary(studentId, matches[0] || null);

  return matches;
}

/**
 * Generate a prompt modifier based on the student's primary archetype.
 * This is injected into the generation prompt to adapt tone and approach.
 */
export async function getArchetypePromptModifier(studentId: string): Promise<string> {
  const result = await db.query(
    `SELECT a.name, a.description, a.config
     FROM student_archetypes a
     JOIN student_archetype_memberships m ON a.id = m.archetype_id
     WHERE m.student_id = $1
     ORDER BY m.similarity_score DESC
     LIMIT 1`,
    [studentId]
  );

  if (result.rows.length === 0) return '';

  const archetype = result.rows[0];
  const modifiers: Record<string, string> = {
    panic_crammer: 'This student is time-pressured and anxious. Prioritize exam-relevant content. Use concise explanations. Provide frequent reassurance. Avoid deep theory unless explicitly requested.',
    deep_diver: 'This student loves depth and connections. Take time to explain the "why" behind concepts. Use rich analogies. Allow exploratory tangents. Do not rush.',
    homework_helper: 'This student engages sporadically and wants practical help. Keep responses short and actionable. Focus on the specific problem at hand. Offer to explain the underlying concept only if they show interest.',
    steady_builder: 'This student prefers structure and steady progress. Provide clear scaffolding. Celebrate incremental progress. Maintain consistent pacing. Give advance warning before changing topics.',
    confidence_seeker: 'This student has low self-efficacy. Celebrate small wins explicitly. Use gentle, encouraging language. Never imply they "should" know something. Build confidence through micro-successes.',
  };

  return modifiers[archetype.name] || `This student matches the "${archetype.name}" profile: ${archetype.description}`;
}

/**
 * Warm-start a new student by copying tentative attributes from the nearest archetype centroid.
 * Called after onboarding completion if the student has few active attributes.
 */
export async function warmStartFromArchetype(studentId: string): Promise<void> {
  const matches = await matchArchetypes(studentId);
  const primary = matches.find(m => m.isPrimary);
  if (!primary || primary.similarityScore < 0.5) return;

  const centroid = await db.query(
    `SELECT config FROM student_archetypes WHERE id = $1`,
    [primary.archetypeId]
  );

  if (centroid.rows.length === 0) return;

  const defaultAttrs = centroid.rows[0].config?.default_attributes;
  if (!defaultAttrs || typeof defaultAttrs !== 'object') return;

  for (const [key, val] of Object.entries(defaultAttrs)) {
    const existing = await db.query(
      `SELECT 1 FROM student_attributes WHERE student_id = $1 AND attribute_key = $2`,
      [studentId, key]
    );
    if (existing.rows.length > 0) continue;

    await db.query(
      `INSERT INTO student_attributes (
        student_id, attribute_key, attribute_value, confidence,
        evidence_json, category, is_active, first_observed, last_updated
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT DO NOTHING`,
      [
        studentId,
        key,
        JSON.stringify(val),
        0.4,
        JSON.stringify([{ source: 'archetype_warm_start', archetype: primary.name, timestamp: new Date().toISOString() }]),
        'contextual_factor',
        false,
      ]
    );
  }

  logger.info(`[Archetypes] Warm-started ${studentId} from archetype ${primary.name}`);
}

/**
 * Weekly batch job entry point.
 * If N >= 100, runs clustering. Otherwise, refreshes rule-based assignments.
 */
export async function runArchetypeClusteringJob(): Promise<void> {
  const countResult = await db.query(`SELECT COUNT(DISTINCT student_id) FROM student_attributes`);
  const studentCount = parseInt(countResult.rows[0].count, 10);

  if (studentCount < 100) {
    logger.info(`[Archetypes] N=${studentCount}, staying in rule-based mode`);
    await refreshAllRuleBasedMatches();
    return;
  }

  logger.info(`[Archetypes] N=${studentCount}, activating clustering mode (stubbed)`);
  // TODO: Phase 2 — implement HDBSCAN or MiniBatch K-Means on attribute embeddings
  // 1. Vectorize each student's active attributes
  // 2. Run clustering algorithm
  // 3. Label clusters with LLM-generated names
  // 4. Update student_archetypes with discovered clusters
  // 5. Save memberships
}

async function loadArchetypes(): Promise<{ id: string; name: string; description: string; config: Record<string, unknown>; is_discovered: boolean }[]> {
  const result = await db.query(
    `SELECT id, name, description, config, is_discovered FROM student_archetypes WHERE is_discovered = false`
  );
  return result.rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config,
    is_discovered: r.is_discovered,
  }));
}

function computeRuleBasedScore(
  config: Record<string, unknown>,
  attributes: Record<string, unknown>
): number {
  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (rules.length === 0) return 0;

  let matches = 0;
  let totalWeight = 0;

  for (const rule of rules) {
    if (!rule.attribute_key || !rule.operator) continue;
    const attr = attributes[rule.attribute_key];
    const attrValue = typeof attr === 'object' && attr !== null ? (attr as Record<string, unknown>).value : attr;
    const weight = typeof rule.weight === 'number' ? rule.weight : 1;

    totalWeight += weight;
    if (ruleMatches(attrValue, rule.operator, rule.value)) {
      matches += weight;
    }
  }

  return totalWeight > 0 ? matches / totalWeight : 0;
}

function ruleMatches(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case 'eq': return actual === expected;
    case 'gt': return typeof actual === 'number' && actual > (expected as number);
    case 'gte': return typeof actual === 'number' && actual >= (expected as number);
    case 'lt': return typeof actual === 'number' && actual < (expected as number);
    case 'lte': return typeof actual === 'number' && actual <= (expected as number);
    case 'contains': return typeof actual === 'string' && typeof expected === 'string' && (actual as string).includes(expected);
    default: return false;
  }
}

async function saveMemberships(studentId: string, matches: ArchetypeMatch[]): Promise<void> {
  for (const match of matches) {
    await db.query(
      `INSERT INTO student_archetype_memberships (student_id, archetype_id, similarity_score, assigned_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (student_id, archetype_id) 
       DO UPDATE SET similarity_score = EXCLUDED.similarity_score, assigned_at = NOW()`,
      [studentId, match.archetypeId, match.similarityScore]
    );
  }
}

async function updateStudentArchetypeSummary(studentId: string, primary: ArchetypeMatch | null): Promise<void> {
  if (!primary) return;
  await db.query(
    `UPDATE student_profiles 
     SET archetype_id = $1::uuid, attribute_summary = $2
     WHERE student_id = $3`,
    [primary.archetypeId, primary.name, studentId]
  );
}

async function refreshAllRuleBasedMatches(): Promise<void> {
  const result = await db.query(`SELECT DISTINCT student_id FROM student_attributes`);
  for (const row of result.rows) {
    await matchArchetypes(row.student_id).catch(err => {
      logger.debug({ err }, `[Archetypes] Failed to match ${row.student_id}`);
    });
  }
}