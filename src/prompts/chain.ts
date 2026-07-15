// Multi-agent pedagogical chain.
// Used for complex situations where a single call isn't enough:
// - Misconceptions detected
// - Student stuck 3+ times
// - High shame situation
// - Exam day
// Each stage builds on the previous stage's output.

import { routeAndCall } from '../llm/router';
import type { LLMMessage } from '../types/llm';
import { logger } from '../middleware/logger';

export interface ChainContext {
  studentMessage: string;
  conversationHistory: string;
  studentMemory: Record<string, string>;
  culturalContext: Record<string, unknown>;
}

export interface ChainResult {
  finalResponse: string;
  log: Record<string, unknown>[];
  pedagogicalStrategy: string;
  emotionalAnalysis: Record<string, unknown>;
}

const STAGE_PROMPTS = {
  emotional_analysis: `You are an emotional intelligence expert analyzing a Nigerian student's message.
Read their emotional state from their words, tone, and conversation history.
Focus on: shame potential, frustration, curiosity, flow, anxiety, tiredness, self-efficacy.
Respond in JSON: {
  "shamePotential": 0-1,
  "frustration": 0-1,
  "curiosity": 0-1,
  "selfEfficacy": 0-1,
  "flowIndicator": 0-1,
  "tiredness": 0-1,
  "dominantEmotion": "string",
  "urgency": "immediate|monitor|low",
  "earlyWarning": "string — what emotional risk to watch for"
}`,

  intent_and_misconception: `You are a pedagogical diagnosis expert.
Identify what the student actually needs (their intent) and any misconceptions in their thinking.
Be specific — don't just say "confusion", say what specific concept they're confused about.
Respond in JSON: {
  "primaryIntent": "seeking_clarification|expressing_confusion|applying_knowledge|exploring_curiosity|requesting_example|showing_understanding|expressing_frustration|exam_prep|teach_back|brain_dump|requesting_summary|casual_greeting|unknown",
  "hasMisconception": boolean,
  "misconceptionDescription": "specific description",
  "misconceptionType": "factual|procedural|conceptual|",
  "inferredTopic": "specific concept",
  "inferredSubject": "Mathematics|Physics|Chemistry|Biology|English|etc",
  "inferredKnowledgeLevel": 0-1,
  "prerequisiteGap": "if a missing prerequisite is suspected, name it"
}`,

  strategy_selection: `You are a master teacher selecting the optimal pedagogical strategy.
Given the student's emotional state and intent, select the best approach for THIS specific moment.
Consider: cultural context, stuck count, mastery level, emotional state.
Respond in JSON: {
  "strategy": "direct_explanation|socratic|scaffolded|analogy_based|metacognitive|celebration|reassurance|pivot_completely|hint_ladder|validation_first|prerequisite_first",
  "reasoning": "why this strategy fits this moment",
  "warmthLevel": 0-1,
  "scaffoldingLevel": 0-1,
  "analogyDomain": "market|football|family|cooking|transport|farming|technology|",
  "checkIn": boolean,
  "questionToAsk": "if socratic, what question to ask",
  "hintLevel": 0-1,
  "avoidRepeatApproach": "string — which approach not to use because it already failed"
}`,

  response_generation: `You are Wax, a warm Nigerian AI tutor. Generate a response using the strategy and analysis from previous stages.

CORE RULES:
- Never say "Certainly!", "Of course!", "Great question!", "Absolutely!", "As an AI", "I'd be happy to help!"
- Use Nigerian analogies and language when appropriate (match student's style)
- Teach one concept at a time
- Do NOT solve problems for the student — guide them
- Correct misconceptions gently: "Actually there's an interesting twist here..."
- End with a natural check-in only if strategy says checkIn:true
- If student uses Pidgin, respond with some Pidgin naturally

Respond with ONLY the response text — nothing else.`,
};

export async function runPedagogicalChain(
  context: ChainContext,
  isComplex: boolean
): Promise<ChainResult> {
  if (!isComplex) {
    // For simple cases, skip the chain and return empty log
    return {
      finalResponse: '',
      log: [],
      pedagogicalStrategy: 'direct_explanation',
      emotionalAnalysis: {},
    };
  }

  logger.info('[PedagogicalChain] Running multi-stage chain');
  const log: Record<string, unknown>[] = [];

  const baseContext: LLMMessage[] = [
    {
      role: 'system',
      content: `Student memory:\n${JSON.stringify(context.studentMemory, null, 2)}`,
    },
    {
      role: 'system',
      content: `Recent conversation:\n${context.conversationHistory}`,
    },
  ];

  // Stage 1: Emotional Analysis
  const stage1 = await runStage('emotional_analysis', context.studentMessage, baseContext, log);
  let emotionalAnalysis: Record<string, unknown> = {};
  try { emotionalAnalysis = JSON.parse(stage1); } catch { emotionalAnalysis = {}; }

  // Stage 2: Intent + Misconception
  const stage2 = await runStage('intent_and_misconception', context.studentMessage, [
    ...baseContext,
    { role: 'system', content: `Emotional analysis: ${stage1}` },
  ], log);

  // Stage 3: Strategy Selection
  const stage3 = await runStage('strategy_selection', context.studentMessage, [
    ...baseContext,
    { role: 'system', content: `Emotional analysis: ${stage1}` },
    { role: 'system', content: `Intent analysis: ${stage2}` },
    { role: 'system', content: `Cultural context: ${JSON.stringify(context.culturalContext)}` },
  ], log);

  let strategy = 'direct_explanation';
  try {
    strategy = JSON.parse(stage3).strategy || 'direct_explanation';
  } catch { /* keep default */ }

  // Stage 4: Response Generation
  const stage4Messages: LLMMessage[] = [
    { role: 'system', content: STAGE_PROMPTS.response_generation },
    ...baseContext,
    { role: 'system', content: `Emotional analysis: ${stage1}` },
    { role: 'system', content: `Intent + misconception analysis: ${stage2}` },
    { role: 'system', content: `Selected strategy: ${stage3}` },
    { role: 'user', content: `Student message: "${context.studentMessage}"` },
  ];

  const response = await routeAndCall(stage4Messages, { maxTokens: 1200 });

  return {
    finalResponse: response.content,
    log,
    pedagogicalStrategy: strategy,
    emotionalAnalysis,
  };
}

async function runStage(
  stageName: keyof typeof STAGE_PROMPTS,
  studentMessage: string,
  context: LLMMessage[],
  log: Record<string, unknown>[]
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: 'system', content: STAGE_PROMPTS[stageName] },
    ...context,
    { role: 'user', content: `Student message: "${studentMessage}"` },
  ];

  const response = await routeAndCall(messages, {
    jsonMode: stageName !== 'response_generation',
    maxTokens: stageName === 'response_generation' ? 1200 : 500,
  });

  log.push({ stage: stageName, output: response.content, latencyMs: response.latencyMs });
  return response.content;
}