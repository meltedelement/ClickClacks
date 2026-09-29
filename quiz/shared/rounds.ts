// Rounds are runs of consecutive questions with the same `round` label.
// Used by the server (team view) and by the admin and presenter pages.
import type { Question, RoundPosition } from './types.ts';

type Labelled = Pick<Question, 'round'>;

export function startsRound(questions: Labelled[], index: number): boolean {
  return index === 0 || questions[index]?.round !== questions[index - 1]?.round;
}

// The questions grouped by round, in order, with the index of each question in the full list.
export function groupRounds<T extends Labelled>(questions: T[]): { label: string; name: string; items: { question: T; index: number }[] }[] {
  const rounds: { label: string; name: string; items: { question: T; index: number }[] }[] = [];
  questions.forEach((question, index) => {
    if (startsRound(questions, index)) rounds.push({ label: question.round, name: roundName(question.round), items: [] });
    rounds[rounds.length - 1].items.push({ question, index });
  });
  return rounds;
}

export function roundName(label: string): string {
  return label.replace(/^Round\s+\d+\s*:\s*/i, '');
}

export function roundPosition(questions: Labelled[], index: number): RoundPosition | null {
  if (!questions[index]) return null;
  const rounds = groupRounds(questions);
  const round = rounds.findIndex((r) => r.items.some((item) => item.index === index));
  const items = rounds[round].items;
  return {
    index: round,
    count: rounds.length,
    name: rounds[round].name,
    position: items.findIndex((item) => item.index === index) + 1,
    size: items.length,
    sizes: rounds.map((r) => r.items.length),
  };
}

// The quiz stops for a battle break after every BATTLE_EVERY question rounds,
// and after the last round. Each break plays one stage of the bracket. The
// break after the last round plays the stages that are left, until there is a
// champion.
export const BATTLE_EVERY = 2;

// True when the question at `index` ends a round that a battle break follows.
export function breakAfter(questions: Labelled[], index: number): boolean {
  const position = roundPosition(questions, index);
  if (!position || position.position !== position.size) return false;
  const done = position.index + 1;
  return done % BATTLE_EVERY === 0 || done === position.count;
}

// How many bracket stages may be played once the quiz has reached question
// `index` (the battle phase keeps the index of the last question before the
// break). Infinity after the last round: the rest of the bracket plays then.
export function stagesAllowed(questions: Labelled[], index: number): number {
  const position = roundPosition(questions, index);
  if (!position) return Infinity; // no questions: the battle is all there is
  const done = position.position === position.size ? position.index + 1 : position.index;
  if (done >= position.count) return Infinity;
  return Math.floor(done / BATTLE_EVERY);
}
