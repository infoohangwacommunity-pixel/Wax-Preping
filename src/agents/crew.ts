// The multi-agent crew.
// This is where all the pieces come together.
// Each agent has a role. They collaborate through the event bus.
// The pedagogical agent synthesizes their inputs and generates the final response.

import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../events/bus";
import { encodeTextMessage } from "../encoders/text";
import { buildWorkingMemory } from "../memory/working";
import { getStudentProfile, applyMemoryEdit } from "../memory/semantic";
import { saveEpisode } from "../memory/episodic";
import { detectEmotionalState, checkForEmotionalAlert } from "../pedagogy/affect";
import { computeForceVector } from "../pedagogy/planner";
import { assemblePrompt, parseMemoryUpdates } from "../prompts/assembler";
import { routeAndCall } from "../llm/router";
import { searchWeb, formatSearchResultsForLLM } from "../tools/search";
import type { StudentMessageReceived } from "../types/events";
import type { ConversationTurn } from "../types/student";
import { getOrCreateSession, saveTurn, touchSession } from "../session/manager";

export async function processTutorMessage(event: StudentMessageReceived): Promise<string> {
  const { studentId, rawMessage, sessionId } = event;

  // 1. Get or create session and load recent history
  const session = await getOrCreateSession(studentId);
  const history = session.conversationHistory;

  // 2. Load student profile (persistent semantic memory)
  const profile = await getStudentProfile(studentId);

  // 3. Encode the message into pedagogical intent
  const intent = encodeTextMessage(rawMessage);

  // 4. Detect emotional state
  const emotionalState = detectEmotionalState(rawMessage, history);

  // 5. Check for emotional alerts that need immediate attention
  const alert = checkForEmotionalAlert(emotionalState, studentId, sessionId);
  if (alert) {
    await eventBus.publish({ ...alert, id: uuidv4() });
  }

  // 6. Build ephemeral working memory from conversation history
  const workingMemory = buildWorkingMemory(history);

  // 7. Compute force vector (the Planner's output)
  const forceVector = computeForceVector(emotionalState, intent, workingMemory, profile);

  // 8. Check if the AI needs to search for anything
  // (Simple heuristic: if the student asks about a specific syllabus, past question, or fact)
  let ragContext: string | undefined;
  const needsSearch =
    /syllabus|past question|mark scheme|waec|jamb|neco|post-utme|explain .{5,30} in detail/.test(
      rawMessage.toLowerCase()
    );

  if (needsSearch) {
    const searchResults = await searchWeb(
      `WAEC JAMB Nigeria ${rawMessage}`,
      "curriculum_lookup"
    );
    ragContext = await formatSearchResultsForLLM(searchResults);
  }

  // 9. Assemble the full context window
  const messages = assemblePrompt(
    rawMessage,
    workingMemory,
    forceVector,
    profile,
    ragContext
  );

  // 10. Call the LLM
  const startTime = Date.now();
  const llmResponse = await routeAndCall(messages);
  const latencyMs = Date.now() - startTime;

  // 11. Parse memory updates the AI embedded in its response
  const { cleanResponse, updates } = parseMemoryUpdates(llmResponse.content);

  // 12. Apply memory updates
  for (const update of updates) {
    const validBlocks = ["humanProfile", "learningStyle", "progress", "shameMap", "curiosityMap", "procedural"];
    const validOps = ["append", "replace", "delete"];
    if (validBlocks.includes(update.block) && validOps.includes(update.operation)) {
      await applyMemoryEdit(
        studentId,
        update.block as keyof typeof profile.memoryBlocks,
        update.operation as "append" | "replace" | "delete",
        update.content
      );
    }
  }

  // 13. Save the turn to episodic memory
  const turn: ConversationTurn = {
    turnId: uuidv4(),
    sessionId,
    studentId,
    turnNumber: session.turnCount + 1,
    studentMessage: rawMessage,
    tutorResponse: cleanResponse,
    emotionalSnapshot: emotionalState,
    plannerForce: forceVector,
    modelUsed: llmResponse.modelUsed,
    latencyMs: llmResponse.latencyMs,
    tokensIn: llmResponse.tokensIn,
    tokensOut: llmResponse.tokensOut,
    costUsd: llmResponse.costUsd,
    toolsUsed: needsSearch ? ["brave_search"] : [],
    timestamp: new Date(),
  };

  await saveEpisode(turn);
  await saveTurn(turn);
  await touchSession(sessionId);

  // 14. Emit the response event
  await eventBus.publish({
    id: uuidv4(),
    type: "tutor.response.generated",
    studentId,
    sessionId,
    timestamp: new Date(),
    responseText: cleanResponse,
    emotionalTone: forceVector.warmth > 0.7 ? "warm" : "encouraging",
    modelUsed: llmResponse.modelUsed,
    latencyMs,
    tokensIn: llmResponse.tokensIn,
    tokensOut: llmResponse.tokensOut,
    costUsd: llmResponse.costUsd,
    usedTool: needsSearch,
    toolName: needsSearch ? "brave_search" : undefined,
    forceVectorApplied: forceVector,
  });

  return cleanResponse;
}