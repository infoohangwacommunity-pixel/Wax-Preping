// The prompt assembler builds the full context window from separate segments.
// Each segment is independently testable and swappable.
// This is NOT a single giant system prompt.
// It is a layered, dynamic construction that changes every turn.

import type { WorkingMemorySnapshot, PlannerForceEmitted } from "../types/events";
import type { StudentProfile } from "../types/student";
import type { LLMMessage } from "../types/llm";
import {
  CORE_PERSONA,
  MEMORY_INJECTION_TEMPLATE,
  WORKING_MEMORY_TEMPLATE,
  FORCE_VECTOR_TEMPLATE,
} from "./persona";

export function assemblePrompt(
  rawMessage: string,
  workingMemory: WorkingMemorySnapshot,
  forceVector: PlannerForceEmitted["forceVector"],
  profile: StudentProfile,
  ragContext?: string
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // 1. Core persona (always present, highest priority)
  messages.push({
    role: "system",
    content: CORE_PERSONA,
  });

  // 2. Persistent memory (what the AI knows about this student from past sessions)
  const memoryContent = MEMORY_INJECTION_TEMPLATE(
    profile.memoryBlocks.humanProfile,
    profile.memoryBlocks.learningStyle,
    profile.memoryBlocks.progress,
    profile.memoryBlocks.shameMap,
    profile.memoryBlocks.curiosityMap,
    profile.memoryBlocks.procedural
  );

  messages.push({
    role: "system",
    content: memoryContent,
  });

  // 3. Ephemeral working memory (this session only)
  messages.push({
    role: "system",
    content: WORKING_MEMORY_TEMPLATE(workingMemory),
  });

  // 4. Force vector (how the Planner wants this response to feel)
  messages.push({
    role: "system",
    content: FORCE_VECTOR_TEMPLATE(forceVector),
  });

  // 5. RAG context (curriculum content if the AI searched for something)
  if (ragContext && ragContext.trim().length > 0) {
    messages.push({
      role: "system",
      content: `[CURRICULUM CONTEXT]\n${ragContext}`,
    });
  }

  // 6. Memory update instructions (the AI decides what to remember after this turn)
  messages.push({
    role: "system",
    content: `After your response, if you learned something important about this student, include a MEMORY_UPDATE block at the very end of your response in this exact format:
MEMORY_UPDATE:block_name:operation:content
Where block_name is one of: humanProfile, learningStyle, progress, shameMap, curiosityMap, procedural
Where operation is one of: append, replace, delete
Example: MEMORY_UPDATE:learningStyle:append:Student prefers market analogies for mathematics

Do not include the MEMORY_UPDATE block unless you genuinely learned something new. Do not invent updates. Only update if this turn revealed something real.`,
  });

  // 7. The student's message (always last)
  messages.push({
    role: "user",
    content: rawMessage,
  });

  return messages;
}

// Parse memory update instructions from the AI's response
export function parseMemoryUpdates(
  responseText: string
): {
  cleanResponse: string;
  updates: { block: string; operation: string; content: string }[];
} {
  const lines = responseText.split("\n");
  const updates: { block: string; operation: string; content: string }[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("MEMORY_UPDATE:")) {
      const parts = line.slice("MEMORY_UPDATE:".length).split(":");
      if (parts.length >= 3) {
        updates.push({
          block: parts[0].trim(),
          operation: parts[1].trim(),
          content: parts.slice(2).join(":").trim(),
        });
      }
    } else {
      cleanLines.push(line);
    }
  }

  return {
    cleanResponse: cleanLines.join("\n").trim(),
    updates,
  };
}