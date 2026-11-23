// The word game's rules, pure: how a guess is marked and what it pays. Shared by
// the server (which scores) and nothing else; the phones are sent the marks.

export const WORD_LENGTH = 5;

/** hit: right letter, right place. near: in the word, elsewhere. miss: not in the word (or not again). */
export type Mark = 'hit' | 'near' | 'miss';

export interface Guess {
  word: string;
  marks: Mark[];
}

/** What a guess pays: a near letter is one upgrade, a hit two. */
export const NEAR_PAYS = 1;
export const HIT_PAYS = 2;
/** What a solved word pays at every later break: all five letters as hits. */
export const SOLVED_PAYS = WORD_LENGTH * HIT_PAYS;

// Lower case, letters only. Null when it isn't five letters.
export function cleanWord(raw: unknown): string | null {
  const word = String(raw ?? '').trim().toLowerCase();
  return /^[a-z]+$/.test(word) && word.length === WORD_LENGTH ? word : null;
}

// Hits first, then nears from what is left of the answer, so a letter guessed
// twice is only marked near as often as the answer still has it.
export function mark(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(guess.length).fill('miss');
  const left = new Map<string, number>();
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) marks[i] = 'hit';
    else left.set(answer[i], (left.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === 'hit') continue;
    const n = left.get(guess[i]) ?? 0;
    if (n > 0) {
      marks[i] = 'near';
      left.set(guess[i], n - 1);
    }
  }
  return marks;
}

export function pays(marks: Mark[]): number {
  return marks.reduce((sum, m) => sum + (m === 'hit' ? HIT_PAYS : m === 'near' ? NEAR_PAYS : 0), 0);
}

export function solves(marks: Mark[]): boolean {
  return marks.length === WORD_LENGTH && marks.every((m) => m === 'hit');
}

// The best each letter has been marked so far, for the keyboard.
export function letterHints(guesses: Guess[]): Record<string, Mark> {
  const rank: Record<Mark, number> = { miss: 0, near: 1, hit: 2 };
  const hints: Record<string, Mark> = {};
  for (const { word, marks } of guesses) {
    for (let i = 0; i < word.length; i++) {
      const known = hints[word[i]];
      if (!known || rank[marks[i]] > rank[known]) hints[word[i]] = marks[i];
    }
  }
  return hints;
}
