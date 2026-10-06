// Rounds are runs of consecutive questions with the same `round` label.
// Used by the server (team view) and by the admin and presenter pages.
import type { Question, RoundBreak, RoundPosition } from './types.ts';

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

// ---- The battle schedule ------------------------------------------------------
// `state.schedule` has one entry per round: how many bracket stages the battle
// break after it plays (0 = no break, 'rest' = every stage left, until there
// is a champion), and whether teams get a transformation pick for that break.
// The last round always ends with a break that plays the rest. The host edits
// the schedule on the admin page's Battle tab.

// The most stages one break can play, other than one that plays the rest.
export const MAX_BREAK_STAGES = 10;

export interface Schedule {
  questions: Labelled[];
  schedule: RoundBreak[];
}

// A one-stage break after every second round and the rest after the last
// round, with a transformation pick for every other break from the first, and
// for the last break (it plays several stages).
export function defaultSchedule(rounds: number): RoundBreak[] {
  let breaks = 0;
  return Array.from({ length: rounds }, (_, round): RoundBreak => {
    const last = round === rounds - 1;
    if (!last && (round + 1) % 2 !== 0) return { stages: 0, transformation: false };
    return { stages: last ? 'rest' : 1, transformation: breaks++ % 2 === 0 || last };
  });
}

// One entry per round, the last one playing the rest. A schedule made for
// another number of rounds (the questions were reloaded) is replaced by the default.
export function fitSchedule(schedule: RoundBreak[] | undefined, rounds: number): RoundBreak[] {
  if (!Array.isArray(schedule) || schedule.length !== rounds) return defaultSchedule(rounds);
  return schedule.map((entry, round) => (round === rounds - 1 ? { ...entry, stages: 'rest' } : entry));
}

// The breaks in order, with the 0-based round each one follows. None after a
// break that plays the rest: the battle is over by then.
export function battleBreaks({ questions, schedule }: Schedule): ({ round: number } & RoundBreak)[] {
  const rounds = groupRounds(questions).length;
  const breaks: ({ round: number } & RoundBreak)[] = [];
  for (const [round, entry] of fitSchedule(schedule, rounds).entries()) {
    if (entry.stages === 0) continue;
    breaks.push({ round, ...entry });
    if (entry.stages === 'rest') break;
  }
  return breaks;
}

// Rounds finished once the quiz is at question `index` (the battle phase keeps
// the index of the last question before the break).
function roundsDone(position: RoundPosition): number {
  return position.position === position.size ? position.index + 1 : position.index;
}

// True when the question at `index` ends a round that a battle break follows.
export function breakAfter(quiz: Schedule, index: number): boolean {
  const position = roundPosition(quiz.questions, index);
  if (!position || position.position !== position.size) return false;
  return battleBreaks(quiz).some((b) => b.round === position.index);
}

// How many bracket stages may be played once the quiz has reached question
// `index`. Infinity once a break that plays the rest is reached.
export function stagesAllowed(quiz: Schedule, index: number): number {
  const position = roundPosition(quiz.questions, index);
  if (!position) return Infinity; // no questions: the battle is all there is
  const done = roundsDone(position);
  let stages = 0;
  for (const b of battleBreaks(quiz)) {
    if (b.round >= done) break;
    if (b.stages === 'rest') return Infinity;
    stages += b.stages;
  }
  return stages;
}

// How many transformation picks teams have been given once the quiz has
// reached question `index`. A break's pick opens as soon as the quiz is past
// the break before it, so teams can pick during the questions that lead up to it.
export function transformationsOpen(quiz: Schedule, index: number): number {
  const position = roundPosition(quiz.questions, index);
  if (!position) return 0;
  let open = 0;
  let previous = -1; // the round the last break followed
  for (const b of battleBreaks(quiz)) {
    if (position.index <= previous) break;
    if (b.transformation) open++;
    previous = b.round;
  }
  return open;
}

// The break the quiz is heading for (or is in) at question `index`, or null when none is left.
export function nextBreak(quiz: Schedule, index: number): ({ round: number } & RoundBreak) | null {
  const position = roundPosition(quiz.questions, index);
  if (!position) return null;
  return battleBreaks(quiz).find((b) => b.round >= position.index) ?? null;
}
