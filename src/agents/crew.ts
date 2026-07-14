import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../events/bus';
import { encodeTextMessage } from '../encoders/text';
import { routeAndEncode } from '../encoders/router';
import { buildWorkingMemory } from '../memory/working';
import { getStudentProfile, applyMemoryEdit, updateStudyStreak, incrementTurns, updateConceptProgress, saveAnalogy, updateErrorDiary } from '../memory/semantic';
import { saveEpisode, recallRelevantEpisodes, getRecentHistory } from '../memory/episodic';
import { detectEmotionalState, checkForEmotionalAlert } from '../pedagogy/affect';
import { computeForceVector } from '../pedagogy/planner';
import { detectMasterySignal, detectCognitiveLoad } from '../pedagogy/mastery';
import { assemblePrompt, parseWaxData } from '../prompts/assembler';
import { routeAndCall } from '../llm/router';
import { searchForCurriculum, findPastExamQuestions } from '../tools/search';
import { getDueReviews, scheduleConceptReview } from '../features/spaced_repetition';
import { getExamCountdownMessage } from '../features/exam_countdown';
import { getStreakMessage, getNightOwlMessage, getBeforeExamMessage } from '../features/streak_tracker';
import { detectCulturalContext } from '../features/cultural_context';
import { getOrCreateSession, saveTurn, touchSession } from '../session/manager';
import { logger } from '../middleware/logger';
import type { StudentMessageReceived } from '../types/events';
import type { ConversationTurn } from '../types/student';

export interface ProcessMessageInput {
  studentId: string;
  sessionId: string;
  rawMessage: string;
  messageId: string;
  modality: 'text' | 'image' | 'audio' | 'document' | 'video';
  mediaId?: string;
  mediaCaption?: string;
  isFirstMessage?: boolean;
}

export async function processTutorMessage(input: ProcessMessageInput): Promise<string> {
  const { studentId, sessionId, rawMessage, modality, mediaId, mediaCaption, isFirstMessage } = input;

  try {
    // 1. Load session and history
    const session = await getOrCreateSession(studentId);
    const history = await getRecentHistory(session.sessionId, 12);

    // 2. Load student profile
    const profile = await getStudentProfile(studentId);

    // 3. Update streak
    const newStreak = await updateStudyStreak(studentId);
    await incrementTurns(studentId);

    // 4. Encode the input (text, image, voice, document)
    const { intent, modality: detectedModality } = await routeAndEncode(
      { type: modality === 'audio' ? 'audio' : modality, text: rawMessage, mediaId, caption: mediaCaption },
      history.slice(-5).map(t => t.studentMessage),
      history.filter(t => t.studentMessage.toLowerCase().includes(rawMessage.toLowerCase().slice(0, 30))).length
    );

    // 5. Detect cultural context (update if first session or significant messages)
    if (profile.totalTurns <= 5 || profile.culturalContext.country === 'Nigeria') {
      const culturalCtx = detectCulturalContext(studentId, history.slice(-5).map(t => t.studentMessage));
      // Store if meaningfully different
      if (culturalCtx.region !== 'unknown' && profile.culturalContext.region === 'unknown') {
        await applyMemoryEdit(studentId, 'humanProfile', 'append', `Region detected: ${culturalCtx.region}`);
      }
    }

    // 6. Detect emotional state
    const emotionalState = detectEmotionalState(intent.rawMessage, history);

    // 7. Check for emotional alerts
    const alert = checkForEmotionalAlert(emotionalState, studentId, sessionId);
    if (alert) {
      await eventBus.publish({ ...alert, id: uuidv4() });
    }

    // 8. Build working memory
    const workingMemory = buildWorkingMemory(history);

    // 9. Check mastery signal from this message
    const masteryCheck = detectMasterySignal(intent.rawMessage, history);

    // 10. Compute force vector
    const forceVector = computeForceVector(emotionalState, intent, workingMemory, profile);

    // 11. Cognitive load check
    const cognitiveLoad = detectCognitiveLoad(intent.rawMessage, history);
    if (cognitiveLoad === 'overloaded') {
      forceVector.scaffolding = Math.min(1, forceVector.scaffolding + 0.3);
      forceVector.pacing = Math.max(-1, forceVector.pacing - 0.4);
      forceVector.warmth = Math.min(1, forceVector.warmth + 0.2);
    }

    // 12. Context enrichment
    const needsSearch = shouldSearch(intent.rawMessage, intent);
    let ragContext: string | undefined;

    if (needsSearch) {
      const [curriculumCtx, pastQCtx] = await Promise.allSettled([
        searchForCurriculum(
          intent.inferredTopic || intent.rawMessage,
          profile.culturalContext.examBoards[0] || 'WAEC'
        ),
        findPastExamQuestions(
          intent.inferredTopic || intent.rawMessage,
          profile.culturalContext.examBoards[0] || 'WAEC'
        ),
      ]);

      const combined = [
        curriculumCtx.status === 'fulfilled' ? curriculumCtx.value : '',
        pastQCtx.status === 'fulfilled' ? pastQCtx.value : '',
      ].filter(Boolean).join('\n\n');

      if (combined.length > 50) ragContext = combined;
    }

    // 13. Special messages
    const streakMsg = getStreakMessage(profile, newStreak) || undefined;
    const examMsg = getExamCountdownMessage(profile) || undefined;
    const nightMsg = getNightOwlMessage(new Date().getHours()) || undefined;
    const beforeExamMsg = getBeforeExamMessage(profile) || undefined;

    const dueReviews = await getDueReviews(studentId);
    const reviewNote = dueReviews.length > 0
      ? `Student has ${dueReviews.length} concepts due for review: ${dueReviews.map(r => r.concept).join(', ')}`
      : undefined;

    // 14. Recall relevant past episodes for this topic
    const relevantPast = intent.inferredTopic
      ? await recallRelevantEpisodes(studentId, intent.inferredTopic, 3)
      : [];

    const pastContext = relevantPast.length > 0
      ? `RELEVANT PAST CONVERSATIONS:\n${relevantPast.map(t => `- On "${t.topic}": Student said "${t.studentMessage.slice(0, 80)}", I responded "${t.tutorResponse.slice(0, 80)}"`).join('\n')}`
      : undefined;

    // 15. Assemble prompt
    const messages = assemblePrompt(intent.rawMessage, workingMemory, forceVector, profile, {
      ragContext: [ragContext, pastContext].filter(Boolean).join('\n\n') || undefined,
      visionContext: (intent as { _visionContext?: Record<string, unknown> })._visionContext,
      examCountdownMessage: examMsg || beforeExamMsg,
      streakMessage: [streakMsg, nightMsg].filter(Boolean).join(' ') || undefined,
      dueReviews: reviewNote,
      isFirstMessage,
    });

    // 16. Call LLM
    const start = Date.now();
    const llmResponse = await routeAndCall(messages);
    const latencyMs = Date.now() - start;

    // 17. Parse structured data from response
    const { cleanResponse, waxData } = parseWaxData(llmResponse.content);

    // 18. Apply memory updates
    if (waxData.memoryUpdates && Array.isArray(waxData.memoryUpdates)) {
      for (const update of waxData.memoryUpdates) {
        if (update.block && update.operation && update.content) {
          await applyMemoryEdit(studentId, update.block as keyof typeof profile.memoryBlocks, update.operation, update.content).catch(() => {});
        }
      }
    }

    // 19. Update concept progress
    if (waxData.topic) {
      await updateConceptProgress(
        studentId,
        waxData.topic,
        waxData.subject || 'General',
        masteryCheck.detected ? 0.1 : 0.02,
        waxData.misconception || undefined,
        waxData.usedAnalogy || undefined
      ).catch(() => {});

      // Save analogy to library
      if (waxData.usedAnalogy) {
        await saveAnalogy(studentId, waxData.topic, waxData.usedAnalogy, 'general', 0.7).catch(() => {});
      }

      // Schedule spaced repetition if needed
      if (waxData.scheduleReview || masteryCheck.detected) {
        await scheduleConceptReview(
          studentId,
          waxData.topic,
          waxData.subject || 'General',
          masteryCheck.level || 0.5
        ).catch(() => {});
      }
    }

    // 20. Update error diary if misconception found
    if (waxData.misconception && waxData.topic) {
      await updateErrorDiary(studentId, waxData.topic, waxData.misconception).catch(() => {});
    }

    // 21. Emit mastery event if detected
    if (masteryCheck.detected && waxData.topic) {
      await eventBus.publish({
        id: uuidv4(),
        type: 'mastery.detected',
        studentId,
        sessionId,
        timestamp: new Date(),
        concept: waxData.topic,
        evidenceType: masteryCheck.evidence as 'self_explanation' | 'novel_application' | 'transfer' | 'teach_back',
        masteryLevel: masteryCheck.level,
      });
    }

    // 22. Save turn to episodic memory
    const turn: ConversationTurn = {
      turnId: uuidv4(),
      sessionId: session.sessionId,
      studentId,
      turnNumber: session.turnCount + 1,
      studentMessage: intent.rawMessage,
      tutorResponse: cleanResponse,
      emotionalSnapshot: emotionalState,
      plannerForce: forceVector,
      modality: detectedModality,
      modelUsed: llmResponse.modelUsed,
      latencyMs,
      tokensIn: llmResponse.tokensIn,
      tokensOut: llmResponse.tokensOut,
      costUsd: llmResponse.costUsd,
      toolsUsed: needsSearch ? ['brave_search'] : [],
      topic: waxData.topic,
      subject: waxData.subject,
      masteryEvidenced: masteryCheck.detected,
      timestamp: new Date(),
    };

    await saveEpisode(turn).catch(() => {});
    await saveTurn(turn).catch(() => {});
    await touchSession(session.sessionId).catch(() => {});

    // 23. Emit response event
    await eventBus.publish({
      id: uuidv4(),
      type: 'tutor.response.generated',
      studentId,
      sessionId,
      timestamp: new Date(),
      responseText: cleanResponse,
      emotionalTone: forceVector.warmth > 0.7 ? 'warm' : 'encouraging',
      modelUsed: llmResponse.modelUsed,
      latencyMs,
      tokensIn: llmResponse.tokensIn,
      tokensOut: llmResponse.tokensOut,
      costUsd: llmResponse.costUsd,
      usedTools: turn.toolsUsed,
      forceVectorApplied: forceVector,
      masteryDetected: masteryCheck.detected ? waxData.topic : undefined,
      misconceptionAddressed: waxData.misconception || undefined,
    });

    return cleanResponse;
  } catch (err) {
    logger.error('[Crew] processTutorMessage failed:', err);
    throw err;
  }
}

function shouldSearch(message: string, intent: import('../types/student').PedagogicalIntent): boolean {
  const m = message.toLowerCase();
  return (
    /syllabus|past question|mark scheme|what topics|what chapters|in waec|in jamb|according to/.test(m) ||
    intent.primaryIntent === 'exam_prep' ||
    (intent.temporalPressure === 'exam_tomorrow' || intent.temporalPressure === 'exam_today') ||
    (intent.inferredKnowledgeLevel < 0.3 && message.length > 80)
  );
}