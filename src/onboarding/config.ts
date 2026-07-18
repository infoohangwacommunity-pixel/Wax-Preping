/**
 * Onboarding Configuration — Data-Driven Discovery Goals.
 *
 * NOTHING HERE IS A SCRIPT. These are goals that the AI pursues naturally.
 * The onboarding engine tracks which goals are satisfied, not which turn number we're on.
 * The AI is free to pursue multiple goals in one turn, or spread one goal across turns.
 */
export interface DiscoveryGoal {
  id: string;
  priority: number;
  description: string;
  targetAttributes: string[];
  satisfactionCriteria: string;
  exampleApproaches: string[];
  maxTurnsToSpend: number;
}

export const DEFAULT_DISCOVERY_GOALS: DiscoveryGoal[] = [
  {
    id: 'identity',
    priority: 1,
    description: 'Understand who the student is — name, school level, location, daily life context.',
    targetAttributes: ['name', 'school_level', 'location', 'age_range', 'daily_routine'],
    satisfactionCriteria: 'At least 2 of: name, school level, location are known with confidence >= 0.6',
    exampleApproaches: [
      'Ask "What should I call you?" naturally',
      'Mention "SS2 can be tough" and see if they confirm their level',
      'Ask what their typical school day looks like',
    ],
    maxTurnsToSpend: 2,
  },
  {
    id: 'goals',
    priority: 2,
    description: 'Understand what they are trying to achieve — exams, courses, career, timeline.',
    targetAttributes: ['exam_target', 'intended_course', 'career_aspiration', 'exam_date', 'subjects_needed'],
    satisfactionCriteria: 'At least 2 of: exam target, intended course, career aspiration are known with confidence >= 0.6',
    exampleApproaches: [
      'Ask what they are working toward',
      'Mention "some students are preparing for WAEC, others for JAMB" and let them pick up the thread',
      'Ask what they would study if they could choose anything',
    ],
    maxTurnsToSpend: 2,
  },
  {
    id: 'cognitive_style',
    priority: 3,
    description: 'Discover how they learn best — visual, step-by-step, intuitive, analogy-driven, etc.',
    targetAttributes: ['learns_best_with_analogies', 'prefers_step_by_step', 'prefers_visual', 'prefers_intuitive_leap', 'attention_span'],
    satisfactionCriteria: 'At least 1 cognitive preference attribute is active with confidence >= 0.6',
    exampleApproaches: [
      'Present a tiny concept in two ways and ask which felt clearer',
      'Notice if they say "I see" vs "I get it" vs "walk me through it"',
      'Observe their response to an analogy — do they engage or ask for the "real" explanation?',
    ],
    maxTurnsToSpend: 2,
  },
  {
    id: 'affective_state',
    priority: 4,
    description: 'Understand their motivation, anxiety, time pressure, and emotional relationship with learning.',
    targetAttributes: ['motivation_level', 'anxiety_level', 'exam_pressure', 'time_available', 'past_frustration_with_subject'],
    satisfactionCriteria: 'At least 2 affective attributes are known with confidence >= 0.6',
    exampleApproaches: [
      'Ask what made them reach out today specifically',
      'Notice if they mention deadlines, fear, or excitement',
      'Ask how they usually feel when they sit down to study',
    ],
    maxTurnsToSpend: 2,
  },
  {
    id: 'contextual_factors',
    priority: 5,
    description: 'Understand their practical constraints — device, schedule, internet, study environment.',
    targetAttributes: ['device_type', 'study_schedule', 'internet_quality', 'study_environment', 'support_system'],
    satisfactionCriteria: 'At least 2 contextual factors are known with confidence >= 0.6',
    exampleApproaches: [
      'Ask when they usually have time to read messages',
      'Notice if they mention using a specific phone or having wifi issues',
      'Ask if they study alone or with friends',
    ],
    maxTurnsToSpend: 2,
  },
];

/**
 * Load discovery goals from system_config if available, else use defaults.
 */
export async function loadDiscoveryGoals(): Promise<DiscoveryGoal[]> {
  const { db } = await import('../db/client');
  try {
    const result = await db.query(
      `SELECT content FROM system_config WHERE key = 'onboarding_discovery_goals' LIMIT 1`
    );
    if (result.rows.length > 0) {
      const parsed = typeof result.rows[0].content === 'string' 
        ? JSON.parse(result.rows[0].content) 
        : result.rows[0].content;
      return Array.isArray(parsed) ? parsed : DEFAULT_DISCOVERY_GOALS;
    }
    await db.query(
      `INSERT INTO system_config (key, content) VALUES ('onboarding_discovery_goals', $1) ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify(DEFAULT_DISCOVERY_GOALS)]
    );
  } catch {
    // fallback to defaults
  }
  return DEFAULT_DISCOVERY_GOALS;
}