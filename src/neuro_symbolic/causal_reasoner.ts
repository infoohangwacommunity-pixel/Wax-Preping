// Causal Inference for Learning Paths.
// Answers: "Why is this student struggling with X?"
// Uses the knowledge graph to trace back through prerequisites
// and find the actual root cause of confusion.

import { callBrain } from '../brain/llama_server';
import { getStudentKnowledgeGraph } from './knowledge_graph';
import { db } from '../db/client';

export interface CausalAnalysis {
  rootCause: string;
  causalChain: string[];
  prerequisiteGaps: string[];
  recommendedIntervention: string;
  estimatedSessionsToFix: number;
}

export async function analyzeCausally(
  studentId: string,
  concept: string,
  subject: string
): Promise<CausalAnalysis> {
  const graph = await getStudentKnowledgeGraph(studentId);

  const recentTurns = await db.query(
    `SELECT student_message, tutor_response, topic, ai_analysis
     FROM conversation_turns
     WHERE student_id = $1 AND (topic ILIKE $2 OR subject ILIKE $3)
     ORDER BY timestamp DESC LIMIT 5`,
    [studentId, `%${concept}%`, `%${subject}%`]
  );

  const prompt = `You are a learning scientist analyzing why a student is struggling.

KNOWLEDGE GRAPH STATE:
- Mastered: ${graph.masteredConcepts.join(', ') || 'none'}
- Struggling: ${graph.confusedConcepts.join(', ') || 'none'}
- Blocked concepts: ${graph.blockedConcepts.join(', ') || 'none'}

TARGET CONCEPT: ${concept} (${subject})

RECENT INTERACTIONS ABOUT THIS CONCEPT:
${recentTurns.rows.map((t: Record<string, unknown>) => `Student: "${(t.student_message as string)?.slice(0, 100)}"`).join('\n')}

Perform a causal analysis. Why is this student REALLY struggling with ${concept}?
Look for:
1. Missing prerequisite — they do not know concept X which is required for ${concept}
2. Misconception — they hold a false belief about X that blocks understanding of ${concept}
3. Procedural gap — they understand the concept but cannot apply the steps
4. Cognitive load — too much information at once

Respond in JSON:
{
  "rootCause": "single root cause description",
  "causalChain": ["gap A → gap B → confusion with ${concept}"],
  "prerequisiteGaps": ["missing concept 1", "missing concept 2"],
  "recommendedIntervention": "specific teaching action",
  "estimatedSessionsToFix": 2
}`;

  try {
    const response = await callBrain(prompt, 0.3, 500);
    const cleaned = response.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as CausalAnalysis;
  } catch {
    return {
      rootCause: `Missing prerequisite knowledge for ${concept}`,
      causalChain: [`Prerequisite gap → confusion with ${concept}`],
      prerequisiteGaps: [],
      recommendedIntervention: `Start from first principles for ${concept}`,
      estimatedSessionsToFix: 3,
    };
  }
}