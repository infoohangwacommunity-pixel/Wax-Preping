/**
 * Phase-2 offline validation: BKT, lesson graph, dossier, soft policy.
 * No DB / LLM required.
 */
import { bktFromResult, masteryBand, DEFAULT_BKT } from '../src/teaching/bkt';
import { nextLessonNode, formatLessonPacket, BIOLOGY_FOUNDATION } from '../src/teaching/lesson_graph';
import { buildStudentDossier } from '../src/memory/dossier';
import { decideTeachingPolicy, applyPolicyToPlan } from '../src/teaching/policy';
import { EMPTY_SESSION_STATE } from '../src/session/manager';
import type { PerceptionResult, TeachingPlan } from '../src/types/teaching';
import type { StudentProfile, SessionState } from '../src/types/student';

const failures: string[] = [];

// ── BKT ───────────────────────────────────────────────────────────────────
let p = DEFAULT_BKT.pL0;
const seq: Array<'success' | 'struggle' | 'neutral'> = [
  'success', 'success', 'struggle', 'success', 'success', 'success',
];
for (const r of seq) p = bktFromResult(p, r);
if (!(p > DEFAULT_BKT.pL0)) failures.push(`BKT did not increase after successes: ${p}`);
if (masteryBand(0.2) !== 'novice') failures.push('masteryBand novice failed');
if (masteryBand(0.9) !== 'mastered') failures.push('masteryBand mastered failed');
console.log(`BKT after sequence: P(L)=${p.toFixed(3)} band=${masteryBand(p)}`);

// ── Lesson graph ──────────────────────────────────────────────────────────
const progress: Record<string, { masteryLevel: number }> = {};
let node = nextLessonNode('biology', progress, null);
if (node.id !== 'cells_and_tissues') failures.push(`Expected cells_and_tissues, got ${node.id}`);
progress['cells_and_tissues'] = { masteryLevel: 0.8 };
node = nextLessonNode('biology', progress, 'cells_and_tissues');
if (node.id !== 'cell_structure') failures.push(`Expected cell_structure after mastery, got ${node.id}`);
const packet = formatLessonPacket(node);
if (!packet.includes('micro-lesson')) failures.push('lesson packet missing micro-lesson');
console.log(`Lesson graph: start=${BIOLOGY_FOUNDATION[0].id} next=${node.id}`);

// ── Dossier ───────────────────────────────────────────────────────────────
const profile: StudentProfile = {
  studentId: 'sim',
  createdAt: new Date(),
  lastSeenAt: new Date(),
  totalSessions: 2,
  totalTurns: 12,
  studyStreak: 3,
  lastStudyDate: new Date(),
  examTargets: [{ examType: 'JAMB', subjects: ['Biology'] }],
  culturalContext: {
    country: 'Nigeria', region: 'SE', language: 'en', currency: 'NGN',
    examBoards: ['WAEC', 'JAMB'], timezone: 'Africa/Lagos',
  },
  conceptProgress: {
    cells_and_tissues: {
      conceptId: 'cells_and_tissues', conceptName: 'cells_and_tissues', subject: 'biology',
      firstEncountered: new Date(), lastPracticed: new Date(), masteryLevel: 0.82,
      symbolicBeliefs: [], misconceptions: [], analogiesUsed: [], reviewInterval: 1,
      reviewCount: 1, successCount: 4, attemptCount: 5, bloomLevel: 'understand',
    },
  },
  errorDiary: [],
  analogyLibrary: [],
  memoryBlocks: {
    humanProfile: 'Science student aiming for anatomy at ABSU.',
    learningStyle: 'Needs concrete examples.',
    progress: 'Started cells.',
    shameMap: '',
    curiosityMap: 'Anatomy',
    procedural: '',
    examStrategy: '',
    errorPatterns: '',
    breakthroughs: '',
  },
  facts: {
    intended_course: {
      factKey: 'intended_course', factValue: 'anatomy', confidence: 0.9,
      source: 'instant', updatedAt: new Date(),
    },
    jamb_score: {
      factKey: 'jamb_score', factValue: '189', confidence: 0.9,
      source: 'instant', updatedAt: new Date(),
    },
  },
};
const session: SessionState = {
  ...EMPTY_SESSION_STATE,
  currentSubject: 'biology',
  currentConcept: 'cells_and_tissues',
  readinessSignal: true,
};
const dossier = buildStudentDossier(profile, session);
if (!dossier.includes('intended_course=anatomy')) failures.push('dossier missing fact');
if (!dossier.includes('WEAK CONCEPTS') && !dossier.includes('STRONG CONCEPTS')) {
  failures.push('dossier missing mastery section');
}
console.log('Dossier sample:\n', dossier.slice(0, 400));

// ── Policy still blocks interrogation on ready ────────────────────────────
const perception: PerceptionResult = {
  rawMessage: 'Ok I am ready',
  modality: 'text',
  primaryIntent: 'other',
  inferredTopic: null,
  inferredSubject: 'biology',
  hasMisconception: false,
  misconceptionDescription: null,
  emotionalSignals: {
    valence: 0.6, arousal: 0.4, dominance: 0.5, shamePotential: 0.2,
    curiosity: 0.6, selfEfficacy: 0.4, flowIndicator: 0.4, frustration: 0.1,
    tiredness: 0.1, excitement: 0.5, dominantEmotion: 'ready',
  },
  urgency: 'normal',
  cognitiveLoad: 'medium',
  masterySignal: 'none',
  languageStyle: 'casual',
  temporalPressure: 'none',
  isRepeatedQuestion: false,
  repetitionCount: 0,
};
const policy = decideTeachingPolicy({
  perception,
  profile,
  sessionState: session,
  isFirstMessage: false,
});
const raw: TeachingPlan = {
  strategy: 'socratic',
  strategyReason: 'default',
  warmthLevel: 0.7,
  challengeLevel: 0.5,
  pacing: 'normal',
  hintLevel: 0,
  useAnalogy: false,
  analogyDomain: null,
  askQuestion: true,
  questionPurpose: 'guide_thinking',
  addressMisconception: false,
  misconceptionCorrection: null,
  connectToMemory: null,
  emotionalApproach: 'warm',
  mustInclude: [],
  mustAvoid: [],
  sessionGoal: 'x',
  bloomTarget: 'understand',
  relationshipStage: 'familiar',
  needsTools: [],
  expectedOutcome: 'y',
};
const plan = applyPolicyToPlan(raw, policy);
if (plan.askQuestion) failures.push('ready signal still allows question under hard policy apply');
if (!policy.mustTeachContent) failures.push('ready signal must teach');
console.log(`Ready policy: move=${policy.move} ask=${plan.askQuestion} teach=${policy.mustTeachContent}`);

if (failures.length) {
  console.error('FAILURES:');
  failures.forEach(f => console.error(' -', f));
  process.exit(1);
}
console.log('PHASE-2 CHECKS PASSED');
