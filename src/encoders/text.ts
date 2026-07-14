import type { PedagogicalIntent, EmotionalSnapshot } from '../types/student';

export function detectLanguageStyle(message: string): PedagogicalIntent['languageStyle'] {
  const pidginPatterns = /\b(dey|abi|sha|oya|wahala|abeg|wetin|naija|dem|sabi|chop|joor|ehn|sef|oga)\b/i;
  if (pidginPatterns.test(message)) return 'pidgin';
  if (/[A-Z]{2,}|dear|kindly|hereby|pursuant|sincerely/.test(message)) return 'formal';
  if (/lol|lmao|omg|ngl|tbh|bruh|bro|yo|man|babe/.test(message.toLowerCase())) return 'casual';
  return 'mixed';
}

export function inferPrimaryIntent(message: string): PedagogicalIntent['primaryIntent'] {
  const m = message.toLowerCase();

  if (/^(hi|hello|hey|good morning|good afternoon|good evening|yo|sup|oya let's go|bro)\b/.test(m.trim())) return 'casual_greeting';
  if (/study plan|plan for me|schedule|week by week|how should i study/.test(m)) return 'requesting_study_plan';
  if (/everything i know|brain dump|let me write down|here is what i know/.test(m)) return 'brain_dump';
  if (/explain to you|teach you|so basically you see|let me explain/.test(m)) return 'teach_back';
  if (/summary|summarize|give me the main points|quick review|just the key/.test(m)) return 'requesting_summary';
  if (/passed|failed|how did i do|got my result|i got|my score/.test(m)) return 'reporting_exam_result';
  if (/(waec|jamb|neco|post-utme|exam|test|past question|practice question)/.test(m)) return 'exam_prep';
  if (/(don't get|don't understand|confused|make no sense|what does|i'm lost|not following)/.test(m)) return 'expressing_confusion';
  if (/(why|how|what|explain|can you|could you|tell me|what is|what are).*\?/.test(m)) return 'seeking_clarification';
  if (/(example|show me|give me an example|like for instance)/.test(m)) return 'requesting_example';
  if (/(so basically|i think i get|got it|makes sense|i understand|i see now|ok so)/.test(m)) return 'showing_understanding';
  if (/(hate|too hard|i give up|can't do this|useless|doesn't work|stupid subject)/.test(m)) return 'expressing_frustration';
  if (/(tried|what if i|so does that mean|therefore|because)/.test(m)) return 'applying_knowledge';
  if (/(\?|wonder|what about|curious|hmm|interesting)/.test(m)) return 'exploring_curiosity';

  return 'unknown';
}

export function detectMisconception(message: string): { has: boolean; description?: string } {
  const patterns = [
    { p: /current.*positive.*negative|flows from.*(positive|plus)/, d: 'Conventional current direction misconception' },
    { p: /heavier.*fall faster|mass.*fall|gravity.*weight/, d: 'Galileo misconception: heavier objects fall faster' },
    { p: /plants.*food.*soil|soil.*nutrients.*grow/, d: 'Plants get food from soil, not photosynthesis' },
    { p: /evolution.*purpose|evolved.*to survive|animals evolved to/, d: 'Teleological evolution misconception' },
    { p: /antibiotics.*virus|use antibiotics.*cold/, d: 'Antibiotics treat bacteria not viruses' },
    { p: /multiply.*always bigger|division.*smaller/, d: 'Multiplication/division magnitude misconception' },
    { p: /atom.*tiny ball|nucleus.*middle.*like sun/, d: 'Bohr model oversimplification' },
    { p: /heat.*is.*substance|hot.*thing.*has more heat/, d: 'Heat as substance misconception (caloric theory)' },
    { p: /speed of light.*not constant|light speed changes/, d: 'Speed of light misconception' },
    { p: /force.*needed to keep moving|push.*continues motion/, d: 'Impetus misconception (Aristotelian physics)' },
  ];

  for (const { p, d } of patterns) {
    if (p.test(message.toLowerCase())) return { has: true, description: d };
  }
  return { has: false };
}

export function inferEmotionalSignals(message: string, messageHistory?: string[]): EmotionalSnapshot {
  const m = message.toLowerCase();

  const shamePotential = (() => {
    let s = 0.15;
    if (/i think|maybe|not sure|i don't know|probably|idk|i'm not|perhaps/.test(m)) s += 0.2;
    if (/i'm stupid|i'm dumb|everyone else|can't do anything|hopeless/.test(m)) s += 0.45;
    if (message.trim().length < 12) s += 0.1;
    if (messageHistory) {
      const recentShort = messageHistory.slice(-3).filter(msg => msg.length < 15).length;
      s += recentShort * 0.08;
    }
    return Math.min(1, s);
  })();

  const curiosity = (() => {
    let c = 0.3;
    if (/\?/.test(message) && message.length > 25) c += 0.3;
    if (/why|how|what if|but then|interesting|oh wait|wait so|curious|wonder/.test(m)) c += 0.25;
    if (message.length > 100) c += 0.1;
    return Math.min(1, c);
  })();

  const frustration = (() => {
    let f = 0.1;
    if (/hate|useless|stupid|i give up|why is|so hard|waste of time|annoying/.test(m)) f += 0.5;
    if (/!!!|argh|ugh|smh/.test(message)) f += 0.2;
    return Math.min(1, f);
  })();

  const selfEfficacy = (() => {
    let e = 0.45;
    if (/i get it|i understand|so basically|that means|i can|i know/.test(m)) e += 0.3;
    if (shamePotential > 0.5) e -= 0.25;
    if (frustration > 0.5) e -= 0.2;
    return Math.max(0, Math.min(1, e));
  })();

  const hour = new Date().getHours();
  const tiredness = hour >= 23 || hour < 5 ? 0.7 : hour >= 21 ? 0.4 : 0.1;

  return {
    valence: Math.max(0, 1 - frustration),
    arousal: frustration > 0.5 ? 0.75 : curiosity > 0.6 ? 0.65 : 0.4,
    dominance: selfEfficacy,
    shamePotential,
    curiosity,
    selfEfficacy,
    flowIndicator: curiosity > 0.6 && shamePotential < 0.3 && selfEfficacy > 0.5 ? 0.7 : 0.2,
    frustration,
    tiredness,
    excitement: curiosity > 0.7 && frustration < 0.3 ? 0.7 : 0.2,
  };
}

export function inferTemporalPressure(message: string): PedagogicalIntent['temporalPressure'] {
  const m = message.toLowerCase();
  if (/exam is today|test today|in a few hours|this morning|right now/.test(m)) return 'exam_today';
  if (/tomorrow|tonight|few hours|last minute/.test(m)) return 'exam_tomorrow';
  if (/this week|in \d+ days|next week|soon|preparing/.test(m)) return 'high';
  if (/this month|few weeks|next month/.test(m)) return 'medium';
  if (/eventually|someday|want to understand|curious|just learning/.test(m)) return 'low';
  return 'none';
}

export function encodeTextMessage(
  rawMessage: string,
  messageHistory?: string[],
  repetitionCount = 0
): PedagogicalIntent {
  const misconception = detectMisconception(rawMessage);
  const emotionalSignals = inferEmotionalSignals(rawMessage, messageHistory);

  return {
    primaryIntent: inferPrimaryIntent(rawMessage),
    hasMisconception: misconception.has,
    misconceptionDescription: misconception.description,
    inferredKnowledgeLevel: inferKnowledgeLevel(rawMessage),
    temporalPressure: inferTemporalPressure(rawMessage),
    rawMessage,
    emotionalSignals,
    messageLength: rawMessage.length,
    containsQuestion: rawMessage.includes('?'),
    languageStyle: detectLanguageStyle(rawMessage),
    isRepeatedQuestion: repetitionCount >= 2,
    repetitionCount,
  };
}

function inferKnowledgeLevel(message: string): number {
  const technicalTerms = [
    'derivative', 'integral', 'vector', 'matrix', 'polynomial', 'logarithm',
    'electromagnetic', 'quantum', 'hypothesis', 'theorem', 'osmosis', 'mitochondria',
    'photosynthesis', 'valence', 'covalent', 'gradient', 'stoichiometry',
    'momentum', 'torque', 'entropy', 'electronegativity', 'hybridization',
  ];

  let score = 0.3;
  const found = technicalTerms.filter(t => message.toLowerCase().includes(t));
  score += Math.min(found.length * 0.1, 0.4);
  if (/what is|what are|what does|define/.test(message.toLowerCase())) score -= 0.1;
  if (message.includes('?') && message.length > 40) score += 0.05;

  return Math.max(0.1, Math.min(0.95, score));
}