// The Neuro-Symbolic Knowledge Graph.
// Every student has a living map of what they know, confuse, and haven't seen.
// This is not a float mastery level. It is explicit symbolic beliefs.
// The AI reads this graph and uses it for curriculum decisions.

import { db } from '../db/client';
import { callBrain } from '../brain/llama_server';
import { logger } from '../middleware/logger';

export interface ConceptNode {
  concept: string;
  subject: string;
  prerequisites: string[];
  leadsTo: string[];
  difficulty: number;
  examRelevance: Record<string, number>;
  commonMisconceptions: string[];
}

export interface StudentBelief {
  concept: string;
  claim: string;
  status: 'MASTERS' | 'UNDERSTANDS' | 'CONFUSES' | 'HAS_NOT_SEEN';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  updatedAt: Date;
}

export interface KnowledgeGraphSnapshot {
  studentId: string;
  beliefs: StudentBelief[];
  masteredConcepts: string[];
  confusedConcepts: string[];
  unseenConcepts: string[];
  readyConcepts: string[];
  blockedConcepts: string[];
}

async function getCurriculumNode(concept: string, subject: string): Promise<ConceptNode> {
  // Check cache first
  const cached = await db.query(
    `SELECT content FROM system_config WHERE key = $1`,
    [`curriculum_node_${concept.toLowerCase().replace(/\s+/g, '_')}`]
  );

  if (cached.rows.length > 0) {
    return JSON.parse(cached.rows[0].content) as ConceptNode;
  }

  // Generate from Brain
  const prompt = `You are a Nigerian curriculum expert for WAEC, JAMB, NECO, and Post-UTME.

For the concept "${concept}" in "${subject}":

Generate the curriculum node data. Include:
1. prerequisites: concepts a student MUST understand before this one
2. leads_to: concepts this unlocks
3. difficulty: 0.1 (very easy) to 1.0 (very hard) for Nigerian secondary school level
4. exam_relevance: how important in each exam (WAEC, JAMB, NECO — score 0 to 1)
5. common_misconceptions: what students most commonly get wrong about this

Respond in JSON:
{
  "concept": "${concept}",
  "subject": "${subject}",
  "prerequisites": [],
  "leads_to": [],
  "difficulty": 0.5,
  "examRelevance": {"WAEC": 0.8, "JAMB": 0.7, "NECO": 0.6},
  "commonMisconceptions": []
}`;

  try {
    const response = await callBrain(prompt, 0.2, 600);
    const cleaned = response.replace(/```json|```/g, '').trim();
    const node = JSON.parse(cleaned) as ConceptNode;

    // Cache for 7 days
    await db.query(
      `INSERT INTO system_config (key, content) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
      [`curriculum_node_${concept.toLowerCase().replace(/\s+/g, '_')}`, JSON.stringify(node)]
    );

    return node;
  } catch (err) {
    logger.warn(`[KnowledgeGraph] Failed to generate node for ${concept}:`, err);
    return {
      concept,
      subject,
      prerequisites: [],
      leadsTo: [],
      difficulty: 0.5,
      examRelevance: { WAEC: 0.7, JAMB: 0.7, NECO: 0.6 },
      commonMisconceptions: [],
    };
  }
}

export async function getStudentKnowledgeGraph(studentId: string): Promise<KnowledgeGraphSnapshot> {
  const result = await db.query(
    `SELECT concept_progress, symbolic_knowledge FROM student_profiles WHERE student_id = $1`,
    [studentId]
  );

  if (result.rows.length === 0) {
    return {
      studentId, beliefs: [], masteredConcepts: [], confusedConcepts: [],
      unseenConcepts: [], readyConcepts: [], blockedConcepts: [],
    };
  }

  const row = result.rows[0];
  const conceptProgress = row.concept_progress || {};
  const symbolicKnowledge = row.symbolic_knowledge || {};

  const beliefs: StudentBelief[] = [];
  const masteredConcepts: string[] = [];
  const confusedConcepts: string[] = [];

  for (const [concept, progress] of Object.entries(conceptProgress)) {
    const p = progress as { masteryLevel: number; symbolicBeliefs?: StudentBelief[] };

    if (p.symbolicBeliefs) {
      beliefs.push(...p.symbolicBeliefs.map(b => ({ ...b, concept })));
    }

    if (p.masteryLevel > 0.7) masteredConcepts.push(concept);
    else if (p.masteryLevel < 0.4) confusedConcepts.push(concept);
  }

  // Determine ready and blocked concepts from knowledge graph
  const readyConcepts: string[] = [];
  const blockedConcepts: string[] = [];

  for (const concept of confusedConcepts) {
    const node = await getCurriculumNode(concept, 'general').catch(() => null);
    if (!node) continue;

    const prerequisitesMet = node.prerequisites.every(p =>
      masteredConcepts.includes(p) ||
      (conceptProgress[p] as { masteryLevel?: number })?.masteryLevel > 0.6
    );

    if (prerequisitesMet) {
      readyConcepts.push(concept);
    } else {
      blockedConcepts.push(concept);
    }
  }

  return {
    studentId,
    beliefs,
    masteredConcepts,
    confusedConcepts,
    unseenConcepts: Object.keys(symbolicKnowledge).filter(k =>
      !masteredConcepts.includes(k) && !confusedConcepts.includes(k)
    ),
    readyConcepts,
    blockedConcepts,
  };
}

export async function findMissingPrerequisites(
  studentId: string,
  concept: string,
  subject: string
): Promise<string[]> {
  const node = await getCurriculumNode(concept, subject);
  const graph = await getStudentKnowledgeGraph(studentId);

  return node.prerequisites.filter(prereq =>
    !graph.masteredConcepts.includes(prereq) &&
    !graph.masteredConcepts.includes(prereq.toLowerCase())
  );
}

export async function suggestNextConcept(
  studentId: string,
  subject: string,
  examBoard: string
): Promise<string | null> {
  const graph = await getStudentKnowledgeGraph(studentId);

  // Prioritize ready concepts (prerequisites met, not yet mastered)
  if (graph.readyConcepts.length > 0) {
    // Sort by exam relevance
    const withRelevance = await Promise.all(
      graph.readyConcepts.map(async concept => {
        const node = await getCurriculumNode(concept, subject).catch(() => null);
        const relevance = node?.examRelevance[examBoard] || 0.5;
        return { concept, relevance };
      })
    );
    withRelevance.sort((a, b) => b.relevance - a.relevance);
    return withRelevance[0]?.concept || null;
  }

  return null;
}