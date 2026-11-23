// Where the words come from. The answer is a past New York Times Wordle answer,
// from a random day of its archive (a curated, everyday word); a guess is checked
// against the Free Dictionary API. Both are open and need no key. Offline, the
// answer comes from a short list here, and every five-letter guess is allowed.
import { WORD_LENGTH } from '../shared/word.ts';
import type { Random } from '../../royale/shared/draft.ts';

export interface WordSource {
  /** A five-letter answer, lower case. Never fails: falls back to a built-in word. */
  answer(): Promise<string>;
  /** Whether a clean five-letter guess is a real word. Lenient: true when it can't tell. */
  isWord(word: string): Promise<boolean>;
}

const ANSWERS_API = 'https://www.nytimes.com/svc/wordle/v2';
const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const FIRST_DAY = Date.UTC(2021, 5, 19); // the archive's first answer
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 4_000;

// Used when the archive can't be reached.
export const FALLBACK_ANSWERS = [
  'apple', 'baker', 'beach', 'blade', 'brave', 'bread', 'brick', 'cabin', 'candy', 'chair',
  'charm', 'chess', 'cliff', 'cloud', 'crane', 'crown', 'dance', 'dream', 'eagle', 'earth',
  'flame', 'flute', 'frost', 'fruit', 'ghost', 'giant', 'glove', 'grape', 'heart', 'honey',
  'horse', 'house', 'jelly', 'knife', 'lemon', 'light', 'magic', 'maple', 'mouse', 'night',
  'ocean', 'olive', 'paint', 'pearl', 'piano', 'pilot', 'plant', 'queen', 'river', 'robot',
  'salad', 'shark', 'sheep', 'shelf', 'smile', 'snake', 'spoon', 'storm', 'sugar', 'sword',
  'table', 'tiger', 'toast', 'tower', 'train', 'trick', 'whale', 'wheel', 'witch', 'zebra',
];

async function getJson(url: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  return { status: res.status, data: res.ok ? await res.json() : null };
}

export function httpWords(random: Random = Math.random): WordSource {
  const known = new Map<string, boolean>(); // the dictionary's answers, kept for the night

  function fallback(): string {
    return FALLBACK_ANSWERS[Math.floor(random() * FALLBACK_ANSWERS.length)];
  }

  return {
    async answer() {
      // Up to yesterday: today's answer may be someone's puzzle in progress.
      const days = Math.floor((Date.now() - FIRST_DAY) / DAY_MS) - 1;
      const date = new Date(FIRST_DAY + Math.floor(random() * days) * DAY_MS).toISOString().slice(0, 10);
      try {
        const { data } = await getJson(`${ANSWERS_API}/${date}.json`);
        const solution = String((data as { solution?: unknown } | null)?.solution ?? '').toLowerCase();
        if (/^[a-z]+$/.test(solution) && solution.length === WORD_LENGTH) {
          known.set(solution, true);
          return solution;
        }
      } catch {
        // Offline, or the archive moved: a word from the list.
      }
      return fallback();
    },

    async isWord(word) {
      const cached = known.get(word);
      if (cached !== undefined) return cached;
      try {
        const { status } = await getJson(`${DICTIONARY_API}/${word}`);
        if (status === 200 || status === 404) {
          known.set(word, status === 200);
          return status === 200;
        }
      } catch {
        // Can't tell: let it through rather than stall the round.
      }
      return true;
    },
  };
}
