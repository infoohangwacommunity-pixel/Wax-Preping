/**
 * Subject pedagogy — v3.0: configuration-driven, no hardcoded subjects.
 *
 * The old DEFAULT_PEDAGOGY object with hardcoded subjects (mathematics, physics,
 * biology, etc.) has been removed. Pedagogy is now loaded from system_config
 * or falls back to a generic template. New subjects can be added by inserting
 * config rows — no code changes required.
 */
import { db } from '../db/client';
import { logger } from '../middleware/logger';

export interface SubjectPedagogy {
  subject: string;
  commonMisconceptions: string[];
  analogyDomains: string[];
  localContext: string;
  examTips: string;
  bloomScaffolds: Record<string, string>;
}

const GENERIC_PEDAGOGY: SubjectPedagogy = {
  subject: 'general',
  commonMisconceptions: [
    'Confusing memorization with understanding',
    'Applying formulas without understanding their derivation',
    'Ignoring units in calculations',
    'Mixing up similar-sounding concepts',
  ],
  analogyDomains: ['everyday life', 'sports', 'cooking', 'farming', 'market trading', 'music'],
  localContext: 'Nigerian secondary school context (WAEC/JAMB/NECO). Use local examples when helpful.',
  examTips: 'WAEC and JAMB favor application over memorization. Show working clearly. Watch for trick questions.',
  bloomScaffolds: {
    remember: 'Define and identify',
    understand: 'Explain in your own words',
    apply: 'Solve a similar problem',
    analyze: 'Compare and contrast',
    evaluate: 'Judge which approach is better',
    create: 'Design a new solution',
  },
};

/**
 * Load pedagogy for a subject from system_config.
 * If not found, returns generic pedagogy.
 */
export async function getSubjectPedagogy(subject: string | null | undefined): Promise<SubjectPedagogy> {
  if (!subject || subject === 'general') return GENERIC_PEDAGOGY;

  try {
    const result = await db.query(
      `SELECT content FROM system_config WHERE key = $1 LIMIT 1`,
      [`pedagogy_${subject.toLowerCase()}`]
    );

    if (result.rows.length > 0) {
      const parsed = typeof result.rows[0].content === 'string'
        ? JSON.parse(result.rows[0].content)
        : result.rows[0].content;
      return { ...GENERIC_PEDAGOGY, ...parsed, subject: subject.toLowerCase() };
    }
  } catch (err) {
    logger.debug({ err }, `[Strategies] Failed to load pedagogy for ${subject}`);
  }

  return { ...GENERIC_PEDAGOGY, subject: subject.toLowerCase() };
}

/**
 * Format pedagogy into prompt context.
 */
export function formatSubjectContext(
  pedagogy: SubjectPedagogy,
  subject: string | null,
  concept: string | null,
  knowledgeLevel: number
): string {
  const levelDesc = knowledgeLevel < 0.3 ? 'beginner' : knowledgeLevel < 0.7 ? 'intermediate' : 'advanced';
  const lines = [
    `SUBJECT: ${pedagogy.subject}`,
    `STUDENT LEVEL: ${levelDesc} (${(knowledgeLevel * 100).toFixed(0)}% estimated mastery)`,
    `CONCEPT: ${concept || 'unknown'}`,
    `LOCAL CONTEXT: ${pedagogy.localContext}`,
    `COMMON MISCONCEPTIONS TO WATCH FOR: ${pedagogy.commonMisconceptions.join('; ')}`,
    `ANALOGY DOMAINS (use naturally, not forced): ${pedagogy.analogyDomains.join(', ')}`,
    `EXAM TIPS: ${pedagogy.examTips}`,
    `BLOOM SCAFFOLDS: ${Object.entries(pedagogy.bloomScaffolds).map(([k, v]) => `${k}: ${v}`).join(' | ')}`,
  ];
  return lines.join('\n');
}

/**
 * Seed default pedagogy configs into system_config.
 * Call this once during setup or migration.
 */
export async function seedDefaultPedagogies(): Promise<void> {
  const defaults: Record<string, Partial<SubjectPedagogy>> = {
    mathematics: {
      commonMisconceptions: [
        'Thinking a negative times a negative is negative',
        'Distributing exponents: (a+b)² = a² + b²',
        'Confusing perimeter and area',
        'Canceling terms instead of factors',
      ],
      analogyDomains: ['cooking recipes', 'sharing food', 'market trading', 'building construction', 'sports statistics'],
      localContext: 'Nigerian WAEC/JAMB math. Heavy on algebra, geometry, statistics. Students often struggle with word problems.',
      examTips: 'JAMB math is time-pressured. Practice speed. WAEC rewards showing working. Never leave a question blank — attempt something.',
    },
    biology: {
      commonMisconceptions: [
        'Plants get most of their mass from soil (not CO₂)',
        'Evolution is about individual organisms changing',
        'All bacteria are harmful',
        'The heart pumps oxygenated blood to the lungs',
      ],
      analogyDomains: ['farming and crops', 'cooking and digestion', 'market supply chains', 'family relationships', 'NEPA power distribution'],
      localContext: 'Nigerian WAEC biology emphasizes ecology, genetics, and physiology. Practical exams test microscope skills.',
      examTips: 'WAEC biology practical is 40% of the score. Label diagrams clearly. Use scientific names correctly.',
    },
    physics: {
      commonMisconceptions: [
        'Heavier objects fall faster',
        'Force is needed to maintain motion',
        'Current is used up in a circuit',
        'Sound travels faster in vacuum',
      ],
      analogyDomains: ['football and motion', 'water flow and electricity', 'danfo braking and friction', 'market crowds and pressure', 'drumming and waves'],
      localContext: 'Nigerian WAEC/JAMB physics. Students often fear calculations. Emphasize that every formula tells a story.',
      examTips: 'Always state the formula first. Check units. In JAMB, elimination works well for conceptual questions.',
    },
    chemistry: {
      commonMisconceptions: [
        'Chemical bonds store energy (they don\'t — breaking them releases it)',
        'The periodic table is arbitrary ordering',
        'Acids always have pH 0',
        'Physical changes are reversible, chemical changes are not (mostly true but exceptions exist)',
      ],
      analogyDomains: ['cooking and reactions', 'marriage and bonding', 'market mixing and solutions', 'building blocks and atoms', 'traffic and electron flow'],
      localContext: 'Nigerian WAEC chemistry. Organic chemistry is often the hardest section. Practical exams test titration and qualitative analysis.',
      examTips: 'Memorize the qualitative analysis scheme. Practice mole calculations until they are automatic. In organic, focus on functional groups.',
    },
    english: {
      commonMisconceptions: [
        'Longer essays get higher marks',
        'Grammar rules have no exceptions',
        'Shakespeare is irrelevant to modern life',
        'Passive voice is always wrong',
      ],
      analogyDomains: ['music and rhythm', 'fashion and style', 'food and flavor', 'architecture and structure'],
      localContext: 'Nigerian WAEC English (Lexis, Structure, Oral, Essay). Students often struggle with comprehension and summary.',
      examTips: 'Summary: one point per sentence, in your own words. Essay: plan first, then write. Comprehension: read the questions before the passage.',
    },
    economics: {
      commonMisconceptions: [
        'Inflation means prices of everything go up equally',
        'Government spending always causes inflation',
        'A trade surplus is always good',
        'Banks create money out of nothing (partially true but nuanced)',
      ],
      analogyDomains: ['market trading and supply/demand', 'family budgeting', 'farming and production', 'traffic and congestion'],
      localContext: 'Nigerian WAEC/JAMB economics. Heavy on theory of the firm, national income, and international trade. Connect to Nigerian policy debates.',
      examTips: 'Use diagrams wherever possible. Label axes. Explain the real-world implication, not just the theory.',
    },
  };

  for (const [subject, pedagogy] of Object.entries(defaults)) {
    await db.query(
      `INSERT INTO system_config (key, content) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [`pedagogy_${subject}`, JSON.stringify({ ...GENERIC_PEDAGOGY, ...pedagogy, subject })]
    ).catch(() => {});
  }
}
