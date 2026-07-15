// The Meta-Orchestrator. The brain of WaxPrep.
// This replaces ALL hardcoded logic:
// - No more computeForceVector()
// - No more detectEmotionalState()
// - No more inferPrimaryIntent()
// - No more detectMisconception()
// - No more computeHintPrompt()
// The AI reads the situation and decides everything.

import { routeAndCall } from '../llm/router';
import { getToolDescriptionsForPrompt, executeTool } from './tool_registry';
import { logger } from '../middleware/logger';
import type { LLMMessage } from '../types/llm';
import type { AIAnalysis } from '../types/student';

export interface OrchestratorInput {
  studentId: string;
  sessionId: string;
  rawMessage: string;
  modality: string;
  conversationHistory: string;
  memoryBlocks: Record<string, string>;
  culturalContext: Record<string, unknown>;
  studyStreak: number;
  totalTurns: number;
  examTargets: unknown[];
  dueReviews: string;
  isFirstMessage: boolean;
  visionContext?: Record<string, unknown>;
  paralinguistics?: Record<string, unknown>;
}

export interface OrchestratorOutput {
  analysis: Partial<AIAnalysis>;
  toolCalls: { tool: string; params: Record<string, unknown>; reasoning: string }[];
  responseDraft: string;
  waxData: {
    topic: string;
    subject: string;
    misconception: string;
    masterySignal: boolean;
    masteryType: string;
    memoryUpdates: { block: string; operation: string; content: string }[];
    scheduleReview: boolean;
    usedAnalogy: string;
    examStrategyNote: string;
    symbolicBeliefUpdate?: Record<string, unknown>;
  };
}

const ORCHESTRATOR_SYSTEM = `You are the Meta-Orchestrator for WaxPrep — a WhatsApp AI tutoring system for Nigerian students preparing for WAEC, JAMB, NECO, and Post-UTME.

YOUR ROLE: You are NOT just a tutor. You are the orchestrator. You analyze the student's message, decide what tools to use, generate the tutoring response, and update the student's memory — all in a single structured output.

YOUR PERSONALITY AS A TUTOR:
You are Wax — the smart older sibling. You are warm, direct, culturally grounded, and pedagogically sophisticated. You listen more than you talk. You teach one thing at a time. You use Nigerian analogies from the student's actual world. You correct misconceptions gently, like a friend who caught you saying something slightly wrong.

FORBIDDEN PHRASES: Never say "Certainly!", "Of course!", "Great question!", "Absolutely!", "As an AI", "I'd be happy to help!", "I understand your concern." These are banned permanently.

YOUR PROCESS FOR EVERY MESSAGE:
1. EMOTIONAL READING: What is this student feeling right now? Read shame, frustration, curiosity, flow, anxiety, tiredness from their message and conversation history.
2. INTENT DETECTION: What do they actually need? What misconceptions might be present?
3. STRATEGY SELECTION: What pedagogical approach fits this moment? (scaffolded, socratic, celebratory, reassurance, pivot, hint, direct)
4. TOOL DECISIONS: Do you need external information? Past conversations? Curriculum data? Decide now.
5. RESPONSE GENERATION: Write the actual message the student will receive. Be natural. Be human. Use their language.
6. MEMORY UPDATE: What did you learn about this student this turn? Update their profile.
7. STRUCTURED DATA: Fill in the WAXDATA fields for the system.

CRITICAL RULES:
- If shame potential is high: be invisible with scaffolding, never acknowledge the shame directly, use the simplest possible entry point
- If student is in flow: DO NOT interrupt with check-ins or topic changes
- If student is stuck (3+ attempts): NEVER repeat the same approach — completely change angle
- If exam is today: no new concepts, only confidence-building and strategy
- If it's after 11pm: acknowledge tiredness gently, keep response shorter
- If student is teaching you back: play the confused student, ask them to defend their reasoning
- If misconception detected: correct gently with "Actually, there's an interesting twist here..." never with "Wrong" or "Incorrect"
- For images: DO NOT solve the problem — identify the error and guide them to discover it
- For voice notes: if paralinguistics show tremor/anxiety, be extra gentle even if words sound confident

CULTURAL GROUNDING:
Use analogies from Nigerian daily life: market trading, danfo buses, NEPA/generators, football viewing centers, Lagos traffic, groundnut pyramids, keke napep, suya stands, palm wine, local farming. Make the science feel like their neighborhood.

RESPOND IN THIS EXACT JSON FORMAT:
{
  "analysis": {
    "emotionalReading": {
      "shamePotential": 0.0-1.0,
      "frustration": 0.0-1.0,
      "curiosity": 0.0-1.0,
      "flowIndicator": 0.0-1.0,
      "selfEfficacy": 0.0-1.0,
      "tiredness": 0.0-1.0,
      "dominantEmotion": "string"
    },
    "primaryIntent": "string",
    "hasMisconception": boolean,
    "misconceptionDescription": "string",
    "inferredTopic": "string",
    "inferredSubject": "string",
    "inferredKnowledgeLevel": 0.0-1.0,
    "temporalPressure": "none|low|medium|high|exam_tomorrow|exam_today",
    "languageStyle": "formal|casual|pidgin|mixed",
    "pedagogicalStrategy": "direct_explanation|socratic|scaffolded|analogy_based|metacognitive|celebration|reassurance|pivot|hint_ladder",
    "shouldSearch": boolean,
    "searchQuery": "string",
    "cognitiveLoad": "optimal|high|overloaded|low",
    "sessionPhase": "first_message|warmup|deep_learning|exam_prep|wind_down",
    "stuckDetected": boolean,
    "masterySignalDetected": boolean,
    "masteryEvidenceType": "self_explanation|novel_application|transfer|teach_back|"
  },
  "toolCalls": [
    {
      "tool": "tool_name",
      "params": {},
      "reasoning": "why I need this tool"
    }
  ],
  "responseDraft": "The actual message to send to the student. Natural. Human. No forbidden phrases.",
  "waxData": {
    "topic": "specific concept name",
    "subject": "subject name",
    "misconception": "description or empty string",
    "masterySignal": boolean,
    "masteryType": "self_explanation|novel_application|transfer|teach_back|",
    "memoryUpdates": [
      {
        "block": "humanProfile|learningStyle|progress|shameMap|curiosityMap|procedural|examStrategy|errorPatterns|breakthroughs",
        "operation": "append|replace|delete",
        "content": "what to add/replace with"
      }
    ],
    "scheduleReview": boolean,
    "usedAnalogy": "brief description or empty string",
    "examStrategyNote": "exam strategy insight or empty string",
    "symbolicBeliefUpdate": {
      "concept": "concept name",
      "claim": "what student believes",
      "status": "UNDERSTANDS|CONFUSES|HAS_NOT_SEEN|MASTERS",
      "confidence": "high|medium|low",
      "evidence": "what evidence this turn gave"
    }
  }
}`;

export async function orchestrateTurn(input: OrchestratorInput): Promise<{
  response: string;
  analysis: Partial<AIAnalysis>;
  toolsUsed: string[];
  waxData: OrchestratorOutput['waxData'];
  rawOutput: OrchestratorOutput;
}> {
  const messages: LLMMessage[] = [
    { role: 'system', content: ORCHESTRATOR_SYSTEM },
    {
      role: 'system',
      content: `AVAILABLE TOOLS:\n${getToolDescriptionsForPrompt()}`,
    },
    {
      role: 'system',
      content: buildContextBlock(input),
    },
    {
      role: 'user',
      content: buildMessageBlock(input),
    },
  ];

  // Phase 1: Orchestrator analysis + draft
  const orchestratorResponse = await routeAndCall(messages, { jsonMode: true, maxTokens: 2500 });

  let parsed: OrchestratorOutput;
  try {
    parsed = JSON.parse(orchestratorResponse.content) as OrchestratorOutput;
  } catch {
    logger.warn('[Orchestrator] Failed to parse JSON — falling back to raw text');
    return {
      response: orchestratorResponse.content,
      analysis: {},
      toolsUsed: [],
      waxData: defaultWaxData(),
      rawOutput: { analysis: {}, toolCalls: [], responseDraft: orchestratorResponse.content, waxData: defaultWaxData() },
    };
  }

  // Phase 2: Execute tool calls (if any)
  const toolResults: string[] = [];
  const toolsUsed: string[] = [];

  for (const tc of parsed.toolCalls || []) {
    try {
      const result = await executeTool(tc.tool, tc.params, input.studentId);
      toolResults.push(`[${tc.tool} result]: ${result}`);
      toolsUsed.push(tc.tool);
      logger.info(`[Orchestrator] Tool ${tc.tool} executed`, { reasoning: tc.reasoning });
    } catch (err) {
      logger.error(`[Orchestrator] Tool ${tc.tool} failed:`, err);
      toolResults.push(`[${tc.tool} failed]: ${(err as Error).message}`);
    }
  }

  // Phase 3: Synthesize tool results into final response (if tools were used)
  let finalResponse = parsed.responseDraft;

  if (toolResults.length > 0) {
    const synthesisMessages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are Wax, a Nigerian AI tutor. You just gathered information using tools. Now write the final response to the student, incorporating the tool results naturally. Do NOT mention the tools. Just use the information they provided. Be warm, direct, human. No forbidden phrases.`,
      },
      {
        role: 'system',
        content: `Student context:\n${buildContextBlock(input)}`,
      },
      {
        role: 'system',
        content: `Tool results:\n${toolResults.join('\n\n')}`,
      },
      {
        role: 'system',
        content: `Your planned approach: ${parsed.analysis?.pedagogicalStrategy || 'scaffolded'}`,
      },
      {
        role: 'user',
        content: buildMessageBlock(input),
      },
    ];

    const synthResponse = await routeAndCall(synthesisMessages, { maxTokens: 1500 });
    finalResponse = synthResponse.content;
  }

  return {
    response: finalResponse,
    analysis: parsed.analysis || {},
    toolsUsed,
    waxData: parsed.waxData || defaultWaxData(),
    rawOutput: parsed,
  };
}

function buildContextBlock(input: OrchestratorInput): string {
  const blocks = input.memoryBlocks;
  const relevantBlocks = Object.entries(blocks)
    .filter(([, v]) => v && v.length > 30 && !v.startsWith('New student') && !v.startsWith('No '))
    .map(([k, v]) => `[${k.toUpperCase()}]: ${v}`)
    .join('\n\n');

  const parts = [
    `STUDENT PROFILE:`,
    `- Student ID: ${input.studentId}`,
    `- Study streak: ${input.studyStreak} days`,
    `- Total turns: ${input.totalTurns}`,
    `- Country: ${(input.culturalContext.country as string) || 'Nigeria'}`,
    `- Language: ${(input.culturalContext.language as string) || 'English'}`,
    `- Region: ${(input.culturalContext.region as string) || 'unknown'}`,
    `- Exam targets: ${input.examTargets.length > 0 ? JSON.stringify(input.examTargets) : 'none set'}`,
    ``,
    `WHAT I KNOW ABOUT THIS STUDENT:`,
    relevantBlocks || 'First session with this student. Observe and listen.',
    ``,
    `DUE REVIEWS: ${input.dueReviews || 'none'}`,
    ``,
    `CONVERSATION HISTORY (most recent turns):`,
    input.conversationHistory || 'No history yet — this is the first message.',
  ];

  if (input.isFirstMessage) {
    parts.push(`\nFIRST MESSAGE: This is their very first message ever. Do not ask what subject they need help with — they already told you. Respond to what they actually said.`);
  }

  return parts.join('\n');
}

function buildMessageBlock(input: OrchestratorInput): string {
  const parts: string[] = [];

  if (input.modality === 'image' && input.visionContext) {
    const vc = input.visionContext;
    parts.push(`[IMAGE MESSAGE]`);
    parts.push(`Problem in image: ${vc.problemDescription || 'unknown'}`);
    parts.push(`Student's work visible: ${vc.studentWork || 'none'}`);
    parts.push(`Error detected: ${vc.errorType || 'none identified'}`);
    parts.push(`Caption: ${input.rawMessage || 'none'}`);
    parts.push(`\nIMPORTANT: Do NOT solve this. Guide them to find their error.`);
  } else if (input.modality === 'voice' && input.paralinguistics) {
    const p = input.paralinguistics;
    parts.push(`[VOICE MESSAGE]`);
    parts.push(`Transcript: "${input.rawMessage}"`);
    parts.push(`Estimated anxiety from voice: ${p.anxiety}`);
    parts.push(`Estimated tremor: ${p.estimatedTremor}`);
    parts.push(`Speech pace: ${p.estimatedPace}`);
    parts.push(`Note: If anxiety/tremor is high, be extra gentle even if transcript words sound neutral.`);
  } else {
    parts.push(input.rawMessage);
  }

  return parts.join('\n');
}

function defaultWaxData(): OrchestratorOutput['waxData'] {
  return {
    topic: '',
    subject: '',
    misconception: '',
    masterySignal: false,
    masteryType: '',
    memoryUpdates: [],
    scheduleReview: false,
    usedAnalogy: '',
    examStrategyNote: '',
  };
}