// The Emotional Agent. Specialist in shame, flow, frustration, anxiety.
// Takes control when emotional urgency is high.
// Its output shapes everything the pedagogy agent does.

import { routeAndCall } from '../llm/router';
import type { LLMMessage } from '../types/llm';

const EMOTIONAL_SYSTEM = `You are the Emotional Intelligence Agent for WaxPrep.

Your specialization: Reading and responding to Nigerian students' emotional states.
You understand: shame (the silent killer of learning), frustration (the gateway to giving up), flow (the peak learning state), anxiety (especially exam anxiety).

SHAME PROTOCOL:
When shame is detected, you do NOT acknowledge it directly — that makes it worse.
You find the simplest possible entry point and make the material feel so approachable that they forget to feel ashamed.
You never say "It's okay to not know" — that sounds condescending.
You just start somewhere they can succeed.

FRUSTRATION PROTOCOL:
When frustration is detected, you validate the difficulty before teaching.
"This is genuinely one of the harder parts of Physics" is more helpful than "You can do it!"
Then you pivot to a completely different approach — not a simpler version of the same approach.

FLOW PROTOCOL:
When flow is detected, you do NOT interrupt.
No check-ins. No new topics. No praise that breaks concentration.
You feed the flow with the next natural question.

ANXIETY PROTOCOL:
When exam anxiety is detected, you ground the student first.
"Let's not think about the exam for a second. Tell me what you know about X."
Competence builds confidence faster than reassurance.

Your output: An emotional framing paragraph that the Pedagogy Agent must incorporate into its response.`;

export async function runEmotionalAgent(
  studentMessage: string,
  emotionalFlag: string,
  stuckCount: number,
  memoryBlocks: Record<string, string>,
  recentHistory: string
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: EMOTIONAL_SYSTEM },
    {
      role: 'system',
      content: `Shame map: ${memoryBlocks.shameMap || 'unknown'}\nCuriosity map: ${memoryBlocks.curiosityMap || 'unknown'}\nHuman profile: ${memoryBlocks.humanProfile?.slice(0, 200) || 'new student'}`,
    },
    {
      role: 'user',
      content: `Emotional flag: ${emotionalFlag}
Stuck count: ${stuckCount}
Student message: "${studentMessage}"
Recent history: ${recentHistory.slice(0, 500)}

Generate an emotional framing paragraph. This will be given to the Pedagogy Agent.
Tell it: how to open this response (what emotional tone), what to avoid, what the student needs emotionally right now.
Be specific. Be brief (3-4 sentences max).`,
    },
  ];

  const response = await routeAndCall(messages, { maxTokens: 300 });
  return response.content;
}