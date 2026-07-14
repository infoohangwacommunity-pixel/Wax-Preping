import type { WorkingMemorySnapshot, PedagogicalIntent, StudentProfile } from '../types/student';
import type { ForceVector } from '../types/events';
import type { LLMMessage } from '../types/llm';
import {
  CORE_PERSONA,
  buildMemorySegment,
  buildWorkingMemorySegment,
  buildForceVectorSegment,
  STRUCTURED_OUTPUT_INSTRUCTION,
} from './persona';

export function assemblePrompt(
  rawMessage: string,
  wm: WorkingMemorySnapshot,
  fv: ForceVector,
  profile: StudentProfile,
  options: {
    ragContext?: string;
    visionContext?: Record<string, unknown>;
    examCountdownMessage?: string;
    spacedReviewNote?: string;
    streakMessage?: string;
    dueReviews?: string;
    isFirstMessage?: boolean;
    studyPlanContext?: string;
  } = {}
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // 1. Core persona
  messages.push({ role: 'system', content: CORE_PERSONA });

  // 2. First message note
  if (options.isFirstMessage) {
    messages.push({
      role: 'system',
      content: `FIRST MESSAGE: This is the student's very first message. Do NOT ask "What subject do you need help with?" or "What is your name?" — they told you what they need in their message. Respond to what they actually said. Be natural. No formal welcome. Just respond like a person would if a friend texted them.`,
    });
  }

  // 3. Student memory
  messages.push({ role: 'system', content: buildMemorySegment(profile.memoryBlocks) });

  // 4. Streak and special context
  const specialContext: string[] = [];
  if (options.streakMessage) specialContext.push(options.streakMessage);
  if (options.examCountdownMessage) specialContext.push(`EXAM ALERT: ${options.examCountdownMessage}`);
  if (options.dueReviews) specialContext.push(`SPACED REVIEW DUE: ${options.dueReviews}`);
  if (options.studyPlanContext) specialContext.push(`STUDY PLAN: ${options.studyPlanContext}`);
  if (specialContext.length > 0) {
    messages.push({ role: 'system', content: specialContext.join('\n') });
  }

  // 5. Working memory
  messages.push({ role: 'system', content: buildWorkingMemorySegment(wm) });

  // 6. Force vector
  messages.push({ role: 'system', content: buildForceVectorSegment(fv) });

  // 7. Vision context (if image was sent)
  if (options.visionContext) {
    const vc = options.visionContext as { problemDescription?: string; studentWork?: string; errorType?: string };
    messages.push({
      role: 'system',
      content: `IMAGE ANALYSIS:\nProblem: ${vc.problemDescription || 'unknown'}\nStudent's work: ${vc.studentWork || 'none visible'}\nError detected: ${vc.errorType || 'none identified'}\nDo NOT solve the problem. Help the student understand where they went wrong and guide them to the answer.`,
    });
  }

  // 8. RAG curriculum context
  if (options.ragContext) {
    messages.push({ role: 'system', content: `CURRICULUM CONTEXT:\n${options.ragContext}` });
  }

  // 9. Structured output instruction
  messages.push({ role: 'system', content: STRUCTURED_OUTPUT_INSTRUCTION });

  // 10. The student's message
  messages.push({ role: 'user', content: rawMessage });

  return messages;
}

interface ParsedWaxData {
  topic?: string;
  subject?: string;
  misconception?: string;
  masterySignal?: boolean;
  masteryType?: string;
  memoryUpdates?: import('../types/llm').MemoryUpdate[];
  scheduleReview?: boolean;
  usedAnalogy?: string;
  examStrategyNote?: string;
}

export function parseWaxData(rawResponse: string): { cleanResponse: string; waxData: ParsedWaxData } {
  const marker = 'WAXDATA:';
  const idx = rawResponse.lastIndexOf(marker);

  if (idx === -1) {
    return { cleanResponse: rawResponse.trim(), waxData: {} };
  }

  const cleanResponse = rawResponse.slice(0, idx).trim();
  const jsonStr = rawResponse.slice(idx + marker.length).trim();

  try {
    const waxData = JSON.parse(jsonStr) as ParsedWaxData;
    return { cleanResponse, waxData };
  } catch {
    return { cleanResponse, waxData: {} };
  }
}