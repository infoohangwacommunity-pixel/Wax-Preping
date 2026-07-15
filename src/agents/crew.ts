// The crew. Simplified. The AI does the thinking now.
// No hardcoded emotion detection. No hardcoded force vectors.
// No hardcoded intent classification.
// The Meta-Orchestrator handles all of that.
// This file is just coordination and side-effects.

import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../events/bus';
import { orchestrateTurn, type OrchestratorInput } from '../orchestrator/meta';
import { runPedagogicalChain } from '../prompts/chain';
import { runDefenseChecks } from '../prompts/defense';
import { runReflection } from '../orchestrator/reflection';
import { getSubjectContext } from '../prompts/subject_router';
import { buildWorkingMemory, formatHistoryForOrchestrator } from '../memory/working';
import { getStudentProfile, applyMemoryEdit, updateStudyStreak, incrementTurns, updateSymbolicBelief } from '../memory/semantic';
import { saveEpisode, getRecentHistory } from '../memory/episodic';
import { getOrCreateSession, saveTurn, touchSession } from '../session/manager';
import { scheduleConceptReview, getDueReviews } from '../features/spaced_repetition';
import { recordPromptPerformance } from '../prompts/evolution';
import { logger } from '../middleware/logger';
import type { ConversationTurn, AIAnalysis } from '../types/student';

export interface ProcessMessageInput {
  studentId: string;
  sessionId: string;
  rawMessage: string;
  messageId: string;
  modality: 'text' | 'image' | 'audio' | 'document' | 'video';
  isFirstMessage?: boolean;
  visionContext?: Record<string, unknown>;
  paralinguistics?: Record<string, unknown>;
}

export async function processTutorMessage(input: ProcessMessageInput): Promise<string> {
  const { studentId, sessionId, rawMessage, modality, visionContext, paralinguistics, isFirstMessage } = input;

  // 1. Load session and recent history
  const session = await getOrCreateSession(studentId);
  const history = await getRecentHistory(session.sessionId, 12);

  // 2. Load student profile
  const profile = await getStudentProfile(studentId);

  // 3. Update streak
  const newStreak = await updateStudyStreak(studentId);
  await incrementTurns(studentId);

  // 4. Build working memory (raw material for the AI)
  const wm = buildWorkingMemory(history);
  const historyText = formatHistoryForOrchestrator(history, 10);

  // 5. Get due reviews
  const dueReviews = await getDueReviews(studentId);
  const dueReviewsText = dueReviews.length > 0
    ? `${dueReviews.length} concepts due: ${dueReviews.map(r => r.concept).join(', ')}`
    : '';

  // 6. Decide if this needs the full chain (complex cases)
  const needsChain =
    wm.stuckRepetitionCount >= 2 ||
    history.slice(-3).some(t => (t.aiAnalysis?.emotionalReading as { shamePotential?: number })?.shamePotential ?? 0 > 0.6) ||
    (modality === 'image' && visionContext) ||
    isFirstMessage === false && history.length < 3;

  // 7. Run the Meta-Orchestrator
  const orchestratorInput: OrchestratorInput = {
    studentId,
    sessionId,
    rawMessage,
    modality,
    conversationHistory: historyText,
    memoryBlocks: profile.memoryBlocks,
    culturalContext: profile.culturalContext,
    studyStreak: newStreak,
    totalTurns: profile.totalTurns,
    examTargets: profile.examTargets,
    dueReviews: dueReviewsText,
    isFirstMessage: isFirstMessage || false,
    visionContext,
    paralinguistics,
  };

  const start = Date.now();
  let orchestratorResult = await orchestrateTurn(orchestratorInput);

  // 8. If complex case and chain hasn't been used, run pedagogical chain
  if (needsChain && orchestratorResult.analysis.pedagogicalStrategy === 'direct_explanation') {
    const chainResult = await runPedagogicalChain(
      {
        studentMessage: rawMessage,
        conversationHistory: historyText,
        studentMemory: profile.memoryBlocks,
        culturalContext: profile.culturalContext,
      },
      true
    );

    if (chainResult.finalResponse && chainResult.finalResponse.length > 20) {
      orchestratorResult = {
        ...orchestratorResult,
        response: chainResult.finalResponse,
        analysis: {
          ...orchestratorResult.analysis,
          pedagogicalStrategy: chainResult.pedagogicalStrategy,
        },
      };
    }
  }

  const latencyMs = Date.now() - start;

  // 9. Run defense checks
  const defense = await runDefenseChecks(
    rawMessage,
    orchestratorResult.response,
    studentId,
    sessionId
  );

  const finalResponse = defense.finalResponse;

  if (!defense.passesAll) {
    for (const issue of defense.issues) {
      await eventBus.publish({
        id: uuidv4(),
        type: 'defense.triggered',
        studentId,
        sessionId,
        timestamp: new Date(),
        layer: issue.layerName,
        severity: issue.severity,
        issue: issue.issue,
        wasFixed: true,
      });
    }
  }

  // 10. Apply memory updates from AI
  const waxData = orchestratorResult.waxData;
  for (const update of waxData.memoryUpdates || []) {
    if (update.block && update.operation && update.content) {
      await applyMemoryEdit(
        studentId,
        update.block as keyof typeof profile.memoryBlocks,
        update.operation as 'append' | 'replace' | 'delete',
        update.content
      ).catch(() => {});
    }
  }

  // 11. Update symbolic knowledge graph
  if (waxData.symbolicBeliefUpdate) {
    const sbu = waxData.symbolicBeliefUpdate;
    await updateSymbolicBelief(
      studentId,
      sbu.concept as string,
      sbu.claim as string,
      sbu.status as 'UNDERSTANDS' | 'CONFUSES' | 'HAS_NOT_SEEN' | 'MASTERS',
      sbu.confidence as 'high' | 'medium' | 'low',
      sbu.evidence as string
    ).catch(() => {});
  }

  // 12. Schedule spaced repetition if needed
  if (waxData.scheduleReview && waxData.topic) {
    await scheduleConceptReview(studentId, waxData.topic, waxData.subject || 'General', 0.5).catch(() => {});
  }

  // 13. Save the conversation turn
  const analysis = orchestratorResult.analysis as Partial<AIAnalysis>;
  const turn: ConversationTurn = {
    turnId: uuidv4(),
    sessionId: session.sessionId,
    studentId,
    turnNumber: session.turnCount + 1,
    studentMessage: rawMessage,
    tutorResponse: finalResponse,
    modality,
    aiAnalysis: analysis,
    modelUsed: 'groq/llama-3.3-70b-versatile',
    latencyMs,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    toolsUsed: orchestratorResult.toolsUsed,
    topic: waxData.topic || undefined,
    subject: waxData.subject || undefined,
    masteryEvidenced: waxData.masterySignal,
    timestamp: new Date(),
  };

  await saveEpisode(turn).catch(() => {});
  await saveTurn(turn).catch(() => {});
  await touchSession(session.sessionId).catch(() => {});

  // 14. Record prompt performance for evolution engine
  const emotionalReading = analysis.emotionalReading as { shamePotential?: number; frustration?: number; flowIndicator?: number } | undefined;
  await recordPromptPerformance('meta_orchestrator', studentId, sessionId, session.turnCount + 1, {
    studentEngagement: rawMessage.length > 50 ? 0.8 : 0.5,
    masterySignal: waxData.masterySignal,
    shameSpike: (emotionalReading?.shamePotential ?? 0) > 0.7,
    frustrationSpike: (emotionalReading?.frustration ?? 0) > 0.7,
    flowMaintained: (emotionalReading?.flowIndicator ?? 0) > 0.5,
    answerLeak: !defense.passesAll && defense.issues.some(i => i.layerName === 'answer_leak'),
  }).catch(() => {});

  // 15. Run self-reflection asynchronously (non-blocking)
  setImmediate(async () => {
    const reflection = await runReflection(
      studentId, sessionId, session.turnCount + 1,
      rawMessage, finalResponse, analysis
    ).catch(() => null);

    if (reflection) {
      await eventBus.publish({
        id: uuidv4(),
        type: 'reflection.stored',
        studentId,
        sessionId,
        timestamp: new Date(),
        critique: reflection.critique,
        confidenceScore: reflection.confidenceScore,
        improvement: reflection.improvement,
      });
    }
  });

  // 16. Emit mastery event
  if (waxData.masterySignal && waxData.topic) {
    await eventBus.publish({
      id: uuidv4(),
      type: 'mastery.detected',
      studentId,
      sessionId,
      timestamp: new Date(),
      concept: waxData.topic,
      evidenceType: waxData.masteryType || 'unknown',
      masteryLevel: 0.7,
    });

    await applyMemoryEdit(studentId, 'breakthroughs', 'append',
      `Mastered "${waxData.topic}" via ${waxData.masteryType} on ${new Date().toLocaleDateString()}`
    ).catch(() => {});
  }

  // 17. Emit tutor response event
  await eventBus.publish({
    id: uuidv4(),
    type: 'tutor.response.generated',
    studentId,
    sessionId,
    timestamp: new Date(),
    responseText: finalResponse,
    modelUsed: 'groq/llama-3.3-70b-versatile',
    latencyMs,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    toolsUsed: orchestratorResult.toolsUsed,
    defensePassed: defense.passesAll,
    defenseIssues: defense.issues.map(i => i.issue),
  });

  return finalResponse;
}