// The hint ladder. Never gives the answer outright.
// Starts at 10% hint and escalates with each request.
// If the student has tried 5 times and still can't, gives 90% hint.
// But never 100%. The student must always do the last step.

export interface HintState {
  concept: string;
  currentLevel: number;
  maxLevel: number;
  attemptsAtThisLevel: number;
}

export function computeHintPrompt(
  concept: string,
  hintLevel: number,
  studentAttempt?: string
): string {
  const percentage = Math.round(hintLevel * 100);

  if (percentage < 20) {
    return `The student is working on ${concept}. Give a tiny nudge — a guiding question or a very subtle hint. Do NOT give the answer or the approach. Make them think.`;
  }

  if (percentage < 40) {
    return `The student is stuck on ${concept}. Give a 30% hint — point to the right direction or principle without explaining how. "Think about what ${concept.includes('force') ? 'Newton said about motion' : 'happens to energy in this system'}."`;
  }

  if (percentage < 60) {
    return `The student has tried multiple times on ${concept}. Give a 50% hint — reveal the approach but not the steps. "You need to use the formula for X. Do you remember what that formula is?"`;
  }

  if (percentage < 80) {
    return `The student is persistently stuck on ${concept}. Give a 70% hint — show the setup but leave the calculation. "Here's how to set it up: [setup only]. Now you try the numbers."`;
  }

  return `The student has struggled significantly with ${concept}. Give a 90% hint — walk through nearly all of it, but stop right before the final answer. "So we have [everything except final step]. What's the last thing to do?"`;
}

export function getHintLevelFromRepetitions(repetitionCount: number): number {
  if (repetitionCount <= 1) return 0.1;
  if (repetitionCount <= 2) return 0.3;
  if (repetitionCount <= 3) return 0.5;
  if (repetitionCount <= 4) return 0.7;
  return 0.9;
}