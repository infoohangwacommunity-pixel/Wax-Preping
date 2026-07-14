import { db } from '../db/client';
import { routeAndCall } from '../llm/router';

interface ConceptNode {
  concept: string;
  subject: string;
  prerequisites: string[];
  leads_to: string[];
  difficulty: number;
}

export async function buildConceptGraph(
  concept: string,
  subject: string
): Promise<ConceptNode> {
  const response = await routeAndCall([
    {
      role: 'system',
      content: 'You are a curriculum expert for Nigerian secondary school and university entrance exams (WAEC, JAMB). Respond in JSON only.',
    },
    {
      role: 'user',
      content: `For the concept "${concept}" in "${subject}":
List: prerequisites (what must be known first), leads_to (what concepts this unlocks), difficulty (0.1-1.0).
JSON: { "prerequisites": [], "leads_to": [], "difficulty": 0.5 }`,
    },
  ], { jsonMode: true });

  let parsed = { prerequisites: [] as string[], leads_to: [] as string[], difficulty: 0.5 };
  try {
    parsed = JSON.parse(response.content);
  } catch { /* keep defaults */ }

  return { concept, subject, ...parsed };
}

export async function findMissingPrerequisites(
  studentId: string,
  concept: string,
  subject: string
): Promise<string[]> {
  const graph = await buildConceptGraph(concept, subject);

  // Check which prerequisites the student hasn't mastered
  const profileResult = await db.query(
    `SELECT concept_progress FROM student_profiles WHERE student_id = $1`,
    [studentId]
  );

  const conceptProgress = profileResult.rows[0]?.concept_progress || {};

  return graph.prerequisites.filter(prereq => {
    const progress = conceptProgress[prereq.toLowerCase()];
    return !progress || progress.masteryLevel < 0.5;
  });
}

export async function suggestNextConcept(
  studentId: string,
  currentConcept: string,
  subject: string
): Promise<string | null> {
  const graph = await buildConceptGraph(currentConcept, subject);

  const profileResult = await db.query(
    `SELECT concept_progress FROM student_profiles WHERE student_id = $1`,
    [studentId]
  );

  const conceptProgress = profileResult.rows[0]?.concept_progress || {};

  // Find the first unlocked concept the student hasn't mastered yet
  for (const next of graph.leads_to) {
    const progress = conceptProgress[next.toLowerCase()];
    if (!progress || progress.masteryLevel < 0.7) {
      return next;
    }
  }

  return null;
}