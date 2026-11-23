// What the phones and the host page are sent: the bracket's views, plus the word.
import type { AdminPlayer as BracketAdminPlayer, AdminView as BracketAdminView, PlayerView as BracketPlayerView } from '../../bracket/shared/types.ts';
import type { Guess, Mark } from './word.ts';

export type { BracketTournament, BracketView, Described, Phase } from '../../bracket/shared/types.ts';

/** Where a player is with this break's guess. */
export type WordStatus =
  | 'guessing' // may guess now
  | 'guessed' // guessed this break
  | 'missed' // the break's time ran out before they guessed
  | 'solved' // solved the word: no more guesses, full pay every break
  | 'waiting'; // no guess open (during a stage, or before the first break)

export interface WordView {
  status: WordStatus;
  guesses: Guess[];
  /** The best each letter has been marked, for the keyboard. */
  hints: Record<string, Mark>;
  /** Milliseconds left to guess this break, as of when the view was sent. */
  msLeft: number | null;
  /** What this break paid you, once it has. */
  earned: { upgrades: number; transformation: boolean } | null;
  /** The answer, once you've solved it or the tournament is over. */
  answer: string | null;
}

/** One ball's place in the final royale. */
export interface RoyalePlace {
  place: number; // 1-based
  id: string; // the player's public id
  name: string;
  color: string;
  build: string[]; // weapon, then picks
}

/**
 * The royale at the very end: once the tournament has its champion, everyone who
 * played in it fights one battle royale with the build they finished with. Its
 * winner is separate from the champion.
 */
export interface RoyaleView {
  /** soon: about to drop; fighting: on the game (and its winner banner); done: placed; failed: the game refused it. */
  status: 'soon' | 'fighting' | 'done' | 'failed';
  balls: number;
  /** Milliseconds until it drops, as of when the view was sent (soon only). */
  msLeft: number | null;
  /** The arena page for this device, following your own ball. Loaded from `soon` so it is ready when the fight starts. */
  arena: string;
  winner: { id: string; name: string; color: string } | null;
  places: RoyalePlace[];
  /** Sim seconds it lasted, once done. */
  seconds: number | null;
  /** Why it failed. */
  error: string | null;
}

export interface PlayerView extends BracketPlayerView {
  /** Null outside a tournament, or when you aren't in it. */
  word: WordView | null;
  /** The final royale, once the tournament is over (null before, or with fewer than two players to fight it). */
  royale: RoyaleView | null;
}

export interface AdminPlayer extends BracketAdminPlayer {
  word: WordStatus | null;
  guesses: number;
  /** The letters of their last guess as marks only (no letters, so the room can't read the answer). */
  lastMarks: Mark[] | null;
}

export interface AdminView extends Omit<BracketAdminView, 'players'> {
  players: AdminPlayer[];
  guessMsLeft: number | null;
  /** Shown once the tournament is over. */
  answer: string | null;
  royale: RoyaleView | null;
}
