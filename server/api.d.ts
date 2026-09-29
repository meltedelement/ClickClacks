// Types for programs calling the match API (see matches.js for the routes).
// Copy this file into the calling project, or import it by path.

/** A fighter to put in a match. */
export interface FighterInput {
  /** Shown above the ball and in the winner banner. `team` works too. */
  name?: string;
  team?: string;
  /** Ball colour as "#rrggbb". Optional: without it the ball takes its weapon's colour. */
  color?: string;
  /** Weapon id, e.g. "sword". See GET /api/catalog. */
  weapon: string;
  /** Upgrade ids (repeat an id to stack it), or { id: count }. No transformations here. */
  upgrades?: string[] | Record<string, number>;
  /** Transformation ids from `GET /api/catalog`, in the same forms. Applied before the upgrades. */
  transformations?: string[] | Record<string, number>;
}

/** Body of POST /api/matches. */
export interface MatchRequest {
  fighters: [FighterInput, FighterInput];
  /** 0 to 2^32 - 1. The same seed and fighters give the same fight. Random if left out. */
  seed?: number;
  /** Sim seconds before the match is called a draw. Default 180, at most 600. */
  timeLimit?: number;
  /**
   * 'hp': the match never ends in a draw. At the time limit, or after a double
   * KO, the fighter with the most HP left (as a share of max HP) wins, and an
   * exact tie is a seeded coin flip. Default null: a draw is possible.
   */
  tiebreak?: 'hp' | null;
}

export interface Fighter {
  name: string | null;
  color: string | null;
  weapon: string;
  upgrades: string[];
  transformations: string[];
}

export type MatchStatus = 'queued' | 'playing' | 'done' | 'cancelled';

export interface MatchResult {
  /** Index into `fighters`, or null for a draw. */
  winner: 0 | 1 | null;
  /** The winner's name, or its weapon id if it has no name. */
  winnerName: string | null;
  /** 'time' when a draw was called at the time limit, 'hp' when the hp tiebreak picked the winner. */
  reason: 'ko' | 'time' | 'hp';
  /** Sim seconds the match lasted. */
  time: number;
  /** HP left per fighter. */
  hp: [number, number];
}

export interface Match {
  id: string;
  status: MatchStatus;
  fighters: [Fighter, Fighter];
  seed: number;
  timeLimit: number;
  tiebreak: 'hp' | null;
  /** The display screen (0 to screens - 1) it went on, or null while it waits for a free one. */
  screen: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Set once status is 'done'. */
  result: MatchResult | null;
}

/** GET /api/status */
export interface Status {
  /** Display pages connected. Matches only play while this is above 0. */
  displays: number;
  /** Matches the display plays at the same time (the SCREENS setting, 1 to 4). */
  screens: number;
  /** The matches on the screens now, playing or about to start. */
  onScreen: Match[];
  /** The first of onScreen, or null. Kept for callers that play one match at a time. */
  current: Match | null;
  /** Matches not done yet, including the current one. */
  queued: number;
}

/** One entry in `Catalog.upgrades` or `Catalog.transformations`. */
export interface CatalogUpgrade {
  id: string;
  name: string;
  description: string;
  /** Weapon ids it fits, or null for any weapon. */
  weapons: string[] | null;
  /** Upgrade ids a fighter must also have. */
  requires: string[];
  /** Not offered to a fighter that has one of these (it would do nothing). Allowed in a loadout. */
  excludedBy: string[];
  /** null means no limit. */
  maxStacks: number | null;
}

/** GET /api/catalog */
export interface Catalog {
  weapons: { id: string; name: string }[];
  /** Small upgrades. They go in `FighterInput.upgrades`. */
  upgrades: CatalogUpgrade[];
  /** Big upgrades that reshape the weapon. They go in `FighterInput.transformations`. */
  transformations: CatalogUpgrade[];
}

/** Every error response. */
export interface ApiError {
  error: string;
}
