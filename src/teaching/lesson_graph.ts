/**
 * Lesson graph — ordered micro-concepts with ready-to-teach chunks.
 *
 * This is DATA for the tutor, not a forced script. Deliberation / generation
 * receive the next node as context so the model can teach concretely when the
 * student is ready or foundation-weak — without inventing random topics.
 *
 * Research: curriculum sequencing + prerequisite graphs (ITS literature),
 * knowledge spaces, and mastery learning (Bloom).
 */

export interface LessonNode {
  id: string;
  subject: string;
  title: string;
  prerequisites: string[];
  /** Ready-to-send micro-lesson (WhatsApp length). Model may paraphrase. */
  microLesson: string;
  bloomTarget: 'remember' | 'understand' | 'apply';
  examTags: string[];
  localHook: string;
}

/** Biology / anatomy foundation path — primary for WaxPrep anatomy students. */
export const BIOLOGY_FOUNDATION: LessonNode[] = [
  {
    id: 'cells_and_tissues',
    subject: 'biology',
    title: 'Cells — the basic unit of life',
    prerequisites: [],
    microLesson:
      'Everything in your body is built from cells — tiny living units, like rooms in a big house (your body). Each cell has a job: some make energy, some carry messages, some fight germs. Tissues are groups of similar cells working together (like a muscle is many muscle cells). When we study anatomy, we start here: cell → tissue → organ → system.',
    bloomTarget: 'remember',
    examTags: ['WAEC', 'JAMB'],
    localHook: 'Think of a block of flats: rooms = cells, floors = tissues, whole building = organ.',
  },
  {
    id: 'cell_structure',
    subject: 'biology',
    title: 'Cell structure (simple)',
    prerequisites: ['cells_and_tissues'],
    microLesson:
      'A simple animal cell has: (1) cell membrane — the gate that controls what enters/leaves, (2) cytoplasm — the jelly where work happens, (3) nucleus — the control centre with DNA (instructions). Plant cells also have a cell wall and chloroplasts for photosynthesis. For anatomy, animal cell basics matter most first.',
    bloomTarget: 'understand',
    examTags: ['WAEC', 'JAMB'],
    localHook: 'Nucleus is like the principal of a school — it holds the rules.',
  },
  {
    id: 'tissues_types',
    subject: 'biology',
    title: 'Four main tissue types',
    prerequisites: ['cell_structure'],
    microLesson:
      'Four tissue types: epithelial (covers surfaces — skin, lining of gut), connective (supports — bone, blood, fat), muscle (moves), nervous (sends signals). Anatomy is largely: which tissue builds which organ, and what job that organ does.',
    bloomTarget: 'understand',
    examTags: ['WAEC', 'JAMB'],
    localHook: 'Skin covering is epithelial — like the paint and plaster on a wall.',
  },
  {
    id: 'organs_and_systems',
    subject: 'biology',
    title: 'Organs and systems',
    prerequisites: ['tissues_types'],
    microLesson:
      'Organs are structures made of several tissues (heart, liver, brain). Systems are organs working as a team: skeletal, muscular, circulatory, respiratory, digestive, nervous, etc. Anatomy studies structure; physiology studies function. We learn structure first, then function.',
    bloomTarget: 'understand',
    examTags: ['WAEC', 'JAMB'],
    localHook: 'A danfo needs engine + wheels + body — organs; the whole transport network is a system.',
  },
  {
    id: 'skeletal_overview',
    subject: 'biology',
    title: 'Skeletal system overview',
    prerequisites: ['organs_and_systems'],
    microLesson:
      'The skeleton supports the body, protects organs (skull → brain, ribs → lungs/heart), and works with muscles for movement. Axial skeleton = skull, spine, ribs. Appendicular = limbs and girdles. Bones are living tissue — they grow, heal, and store minerals.',
    bloomTarget: 'remember',
    examTags: ['WAEC', 'JAMB'],
    localHook: 'Scaffolding of a building under construction — without it, the structure collapses.',
  },
  {
    id: 'anatomical_terms',
    subject: 'biology',
    title: 'Anatomical direction words',
    prerequisites: ['skeletal_overview'],
    microLesson:
      'Doctors use fixed words so nobody is confused: anterior (front), posterior (back), superior (above), inferior (below), medial (toward midline), lateral (away from midline), proximal (closer to trunk), distal (farther). Learn these early — every anatomy sentence uses them.',
    bloomTarget: 'remember',
    examTags: ['JAMB'],
    localHook: 'Like left/right on a map — shared language so you never get lost.',
  },
];

const BY_SUBJECT: Record<string, LessonNode[]> = {
  biology: BIOLOGY_FOUNDATION,
  anatomy: BIOLOGY_FOUNDATION,
  general: BIOLOGY_FOUNDATION,
};

export function getLessonPath(subject: string | null | undefined): LessonNode[] {
  const key = (subject || 'general').toLowerCase();
  if (key.includes('bio') || key.includes('anat') || key.includes('med')) return BIOLOGY_FOUNDATION;
  return BY_SUBJECT[key] || BIOLOGY_FOUNDATION;
}

export function getNode(id: string): LessonNode | null {
  return BIOLOGY_FOUNDATION.find(n => n.id === id) || null;
}

/**
 * Pick the next concept for this student given mastery map and optional current id.
 * Mastery threshold default 0.65 (proficient enough to advance).
 */
export function nextLessonNode(
  subject: string | null | undefined,
  conceptProgress: Record<string, { masteryLevel?: number }>,
  currentConcept?: string | null,
  masteryThreshold = 0.65
): LessonNode {
  const path = getLessonPath(subject);
  if (currentConcept) {
    const idx = path.findIndex(n => n.id === currentConcept || n.title === currentConcept);
    if (idx >= 0) {
      const cur = path[idx];
      const m = conceptProgress[cur.id]?.masteryLevel ?? conceptProgress[cur.title]?.masteryLevel ?? 0;
      if (m >= masteryThreshold && idx + 1 < path.length) return path[idx + 1];
      return cur;
    }
  }
  for (const node of path) {
    const m = conceptProgress[node.id]?.masteryLevel ?? 0;
    if (m < masteryThreshold) {
      const prereqsMet = node.prerequisites.every(p => (conceptProgress[p]?.masteryLevel ?? 0) >= masteryThreshold * 0.85);
      if (prereqsMet || node.prerequisites.length === 0) return node;
    }
  }
  return path[path.length - 1];
}

/** Format a compact teaching packet for deliberation / generation context. */
export function formatLessonPacket(node: LessonNode): string {
  return [
    `LESSON GRAPH NODE (teach from this if you need concrete content):`,
    `- id: ${node.id}`,
    `- title: ${node.title}`,
    `- bloom: ${node.bloomTarget}`,
    `- local hook: ${node.localHook}`,
    `- micro-lesson: ${node.microLesson}`,
    `Paraphrase in your own warm WhatsApp voice. Do not paste robotically if a shorter chunk fits the moment.`,
  ].join('\n');
}
