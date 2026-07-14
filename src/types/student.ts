export interface EmotionalSnapshot {
  valence: number;
  arousal: number;
  dominance: number;
  shamePotential: number;
  curiosity: number;
  selfEfficacy: number;
  flowIndicator: number;
  frustration: number;
  tiredness: number;
  excitement: number;
}

export interface PedagogicalIntent {
  primaryIntent:
    | 'seeking_clarification'
    | 'applying_knowledge'
    | 'exploring_curiosity'
    | 'expressing_confusion'
    | 'requesting_example'
    | 'showing_understanding'
    | 'expressing_frustration'
    | 'casual_greeting'
    | 'exam_prep'
    | 'brain_dump'
    | 'teach_back'
    | 'requesting_summary'
    | 'requesting_study_plan'
    | 'reporting_exam_result'
    | 'unknown';
  hasMisconception: boolean;
  misconceptionDescription?: string;
  inferredKnowledgeLevel: number;
  inferredTopic?: string;
  inferredSubject?: string;
  temporalPressure: 'none' | 'low' | 'medium' | 'high' | 'exam_tomorrow' | 'exam_today';
  rawMessage: string;
  emotionalSignals: EmotionalSnapshot;
  messageLength: number;
  containsQuestion: boolean;
  languageStyle: 'formal' | 'casual' | 'pidgin' | 'mixed';
  isRepeatedQuestion: boolean;
  repetitionCount?: number;
}

export interface WorkingMemorySnapshot {
  currentTopic: string | null;
  currentSubject: string | null;
  lastMisconception: string | null;
  lastScaffoldUsed: string | null;
  lastAnalogyUsed: string | null;
  studentConfidence: number;
  turnsInCurrentTopic: number;
  salienceRankedTurns: SalientTurn[];
  backgroundSummary: string;
  unresolvedQuestion: string | null;
  studentLeadingConversation: boolean;
  stuckRepetitionCount: number;
  approachesAttempted: string[];
  conceptsVisitedThisSession: string[];
  hintLevelCurrent: number;
}

export interface SalientTurn {
  role: 'student' | 'tutor';
  content: string;
  salienceScore: number;
  tags: string[];
}

export interface StudentProfile {
  studentId: string;
  createdAt: Date;
  lastSeenAt: Date;
  totalSessions: number;
  totalTurns: number;
  studyStreak: number;
  lastStudyDate: Date | null;
  examTargets: ExamTarget[];
  culturalContext: CulturalContext;
  learningStyle: LearningStyle;
  emotionalProfile: EmotionalProfile;
  conceptProgress: Record<string, ConceptProgress>;
  errorDiary: ErrorEntry[];
  analogyLibrary: AnalogyEntry[];
  memoryBlocks: MemoryBlocks;
  studyPlan?: StudyPlan;
}

export interface ExamTarget {
  examType: string;
  examDate?: Date;
  subjects: string[];
  targetScore?: number;
}

export interface CulturalContext {
  country: string;
  region: string;
  language: string;
  currency: string;
  examBoards: string[];
  culturalReferences: string[];
  timezone: string;
}

export interface LearningStyle {
  prefersAnalogies: boolean;
  analogyDomains: string[];
  prefersVisualDescriptions: boolean;
  prefersMath: boolean;
  prefersStoryForm: boolean;
  prefersVoice: boolean;
  toleratesAbstraction: number;
  preferredPace: 'slow' | 'normal' | 'fast';
  prefersShortAnswers: boolean;
  prefersSocratic: boolean;
  respondsToHumor: boolean;
  respondsToChallenge: boolean;
}

export interface EmotionalProfile {
  shameThreshold: number;
  curiosityLevel: number;
  frustrationTolerance: number;
  prideIntelligence: boolean;
  respondsToHumor: boolean;
  needsExplicitValidation: boolean;
  avoidsAdmittingConfusion: boolean;
  messagesAfterMidnight: boolean;
}

export interface ConceptProgress {
  conceptId: string;
  conceptName: string;
  subject: string;
  firstEncountered: Date;
  lastPracticed: Date;
  masteryLevel: number;
  misconceptions: string[];
  analogiesUsed: string[];
  approachesSucceeded: string[];
  approachesFailed: string[];
  nextReviewAt?: Date;
  reviewInterval: number;
  reviewCount: number;
}

export interface ErrorEntry {
  concept: string;
  errorType: string;
  count: number;
  lastOccurred: Date;
  resolved: boolean;
}

export interface AnalogyEntry {
  concept: string;
  analogy: string;
  domain: string;
  effectiveness: number;
  usedAt: Date;
}

export interface MemoryBlocks {
  humanProfile: string;
  learningStyle: string;
  progress: string;
  shameMap: string;
  curiosityMap: string;
  procedural: string;
  examStrategy: string;
  errorPatterns: string;
  breakthroughs: string;
}

export interface StudyPlan {
  createdAt: Date;
  examDate: Date;
  subject: string;
  weeklyTargets: WeeklyTarget[];
  currentWeek: number;
}

export interface WeeklyTarget {
  week: number;
  concepts: string[];
  isCompleted: boolean;
}

export interface ConversationTurn {
  turnId: string;
  sessionId: string;
  studentId: string;
  turnNumber: number;
  studentMessage: string;
  tutorResponse: string;
  emotionalSnapshot: EmotionalSnapshot;
  plannerForce: import('./events').ForceVector | null;
  modality: string;
  modelUsed: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  toolsUsed: string[];
  timestamp: Date;
  topic?: string;
  subject?: string;
  masteryEvidenced?: boolean;
}

export interface Session {
  sessionId: string;
  studentId: string;
  startedAt: Date;
  lastActivityAt: Date;
  turnCount: number;
  conversationHistory: ConversationTurn[];
  currentTopicTrail: string[];
  isActive: boolean;
}