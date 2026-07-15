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

// The AI generates this — not a code function
export interface AIAnalysis {
  emotionalReading: EmotionalSnapshot;
  primaryIntent: string;
  hasMisconception: boolean;
  misconceptionDescription: string;
  inferredTopic: string;
  inferredSubject: string;
  inferredKnowledgeLevel: number;
  temporalPressure: string;
  languageStyle: string;
  pedagogicalStrategy: string;
  warmthLevel: number;
  scaffoldingLevel: number;
  pacing: number;
  useAnalogy: boolean;
  socratic: boolean;
  checkIn: boolean;
  hintLevel: number;
  shouldSearch: boolean;
  searchQuery: string;
  masterySignalDetected: boolean;
  masteryEvidenceType: string;
  cognitiveLoad: string;
  sessionPhase: string;
  stuckDetected: boolean;
}

export interface WorkingMemorySnapshot {
  currentTopic: string | null;
  currentSubject: string | null;
  lastMisconception: string | null;
  lastAnalogyUsed: string | null;
  studentConfidence: number;
  turnsInCurrentTopic: number;
  salienceRankedTurns: SalientTurn[];
  backgroundSummary: string;
  unresolvedQuestion: string | null;
  stuckRepetitionCount: number;
  approachesAttempted: string[];
  conceptsVisitedThisSession: string[];
  hintLevelCurrent: number;
}

export interface SalientTurn {
  role: 'student' | 'tutor';
  content: string;
  salienceScore: number;
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
  timezone: string;
}

export interface ConceptProgress {
  conceptId: string;
  conceptName: string;
  subject: string;
  firstEncountered: Date;
  lastPracticed: Date;
  masteryLevel: number;
  symbolicBeliefs: SymbolicBelief[];
  misconceptions: string[];
  analogiesUsed: string[];
  nextReviewAt?: Date;
  reviewInterval: number;
  reviewCount: number;
}

// Neural-symbolic knowledge representation
export interface SymbolicBelief {
  claim: string;
  status: 'UNDERSTANDS' | 'CONFUSES' | 'HAS_NOT_SEEN' | 'MASTERS';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  updatedAt: Date;
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
  modality: string;
  aiAnalysis: Partial<AIAnalysis>;
  modelUsed: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  toolsUsed: string[];
  topic?: string;
  subject?: string;
  masteryEvidenced?: boolean;
  reflectionScore?: number;
  timestamp: Date;
}

export interface Session {
  sessionId: string;
  studentId: string;
  startedAt: Date;
  lastActivityAt: Date;
  turnCount: number;
  isActive: boolean;
}